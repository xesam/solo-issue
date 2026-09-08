/**
 * U3.5 · 验收残留数据清理（运维脚本）
 * 背景：verify-agent / verify-account / verify-workbench 曾把演示工作区当垃圾场
 * （7 个张三、十余个"机密计划/工作台验证"项目）。此脚本按名称模式清掉历史残留；
 * verify 脚本本身已改为"结束时自删除"（见各脚本尾部 cleanup 段）。
 *
 * 运行：pnpm tsx scripts/ops-cleanup.ts [--dry]
 *   --dry  只打印将删除的内容，不动数据
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");
// 附件目录锚定仓库根而非 process.cwd()：脚本可能被任意目录以绝对路径调用，
// cwd 错位 + rm force 吞 ENOENT = DB 行删了文件全留。
// UPLOAD_DIR 相对路径同样锚仓库根（与服务进程的语义差异：服务进程 cwd 恒为仓库根）
const UPLOADS_ROOT = join(import.meta.dirname, "..", process.env.UPLOAD_DIR || "uploads");

// 验收脚本历史造过的项目名前缀（新增验收脚本请用带时间戳前缀 + 收尾自删）。
// 注意前缀较宽（verify-/qa- 是常见真实项目名），执行前先 --dry 核对误伤面
const PROJECT_PATTERNS = [
  { prefix: "机密-", from: "verify-account / verify-workbench（含「机密计划-」前缀里的私有项目链路）" },
  { prefix: "工作台验证-", from: "verify-workbench（指派链路）" },
  { prefix: "verify-", from: "各 verify 脚本" },
  { prefix: "qa-", from: "UI 评审遗留" },
];

async function main() {
  console.log(DRY ? "\n━━ 清理预览（--dry，不落库）━━\n" : "\n━━ 验收残留清理 ━━\n");

  // 1) 项目（级联清 issues/labels/states/pages/activities；附件文件手动删）
  let projCount = 0;
  let attCount = 0;
  for (const { prefix, from } of PROJECT_PATTERNS) {
    const projects = await prisma.project.findMany({
      where: { name: { startsWith: prefix } },
      select: { id: true, name: true },
    });
    for (const p of projects) {
      // Attachment 无导航关系（纯 FK），需先收集项目内的 issue/comment id
      const issueIds = await prisma.issue.findMany({
        where: { projectId: p.id },
        select: { id: true },
      });
      const commentIds = await prisma.comment.findMany({
        where: { issueId: { in: issueIds.map((i) => i.id) } },
        select: { id: true },
      });
      const atts = await prisma.attachment.findMany({
        where: {
          OR: [
            { issueId: { in: issueIds.map((i) => i.id) } },
            { commentId: { in: commentIds.map((c) => c.id) } },
          ],
        },
        select: { id: true, storageKey: true },
      });
      const files = atts.map((a) => join(UPLOADS_ROOT, a.storageKey));
      console.log(`  ${DRY ? "[dry] " : ""}删项目「${p.name}」(${from})${files.length ? ` · ${files.length} 个附件文件` : ""}`);
      if (!DRY) {
        // Attachment 表无 FK 级联（纯 issueId/commentId 列），项目删除不会带走附件行——
        // 必须显式删行，否则文件删了、行成幽灵（列表/统计仍会数到）
        await prisma.attachment.deleteMany({
          where: { id: { in: atts.map((a) => a.id) } },
        });
        await prisma.project.delete({ where: { id: p.id } });
        // 附件结果对账：rm force 吞 ENOENT，静默失败无从发现——至少把删除失败吵出来
        const results = await Promise.allSettled(
          files.map((f) => rm(f, { force: true }).then(() => true)),
        );
        const failedFiles = results.filter((r) => r.status === "rejected").length;
        if (failedFiles) console.warn(`    ⚠️ ${failedFiles} 个附件文件删除失败（storageKey 见上方收集，可能残留磁盘）`);
      }
      projCount++;
      attCount += files.length;
    }
  }

  // 1.5) E2E 残渣 issue：Playwright spec 中断（Ctrl-C / 进程被杀）时 beforeEach/afterEach 的
  // sweep 都不再执行；正常路径自清（e2e/fixtures.ts），这里是人工兜底。
  // spec 不上传附件，无附件文件可清；评论/活动/通知随 issue 级联删除
  const e2eStale = await prisma.issue.findMany({
    where: { title: { startsWith: "E2E-" } },
    select: { title: true },
  });
  if (e2eStale.length) {
    for (const i of e2eStale) console.log(`  ${DRY ? "[dry] " : ""}删 E2E 残渣 issue「${i.title}」`);
    if (!DRY) await prisma.issue.deleteMany({ where: { title: { startsWith: "E2E-" } } });
  }

  // 2) 测试用户：停用（不物理删——Activity.actor 引用保留审计链）
  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: "@test.local" }, isActive: true },
    select: { id: true, name: true, email: true },
  });
  for (const u of testUsers) {
    console.log(`  ${DRY ? "[dry] " : ""}停用用户 ${u.name} <${u.email}>`);
    if (!DRY) {
      await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
      await prisma.session.deleteMany({ where: { userId: u.id } });
    }
  }

  console.log(
    `\n完成：${projCount} 个项目${attCount ? `、${attCount} 个附件文件` : ""}、${e2eStale.length} 条 E2E 残渣 issue、${testUsers.length} 个测试用户${DRY ? "（预览，未执行）" : ""}`,
  );
  if (DRY) console.log("确认无误后去掉 --dry 执行。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

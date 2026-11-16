// 一次性数据订正（契约 v2）：description 是 issue 正文的唯一正本，descriptionText
// 是服务端派生列；历史上 MCP 直传纯文本形态落库的行只写了 descriptionText、
// description 为 null——网页详情编辑器只读 description，这些行显示为空描述。
// 本脚本把这类行由 descriptionText 反向组装 description（textToDoc 按行拆段落）。
// 幂等可重跑：description 已非空的行不再匹配，二次运行零替换。
// 用法: pnpm backfill-issue-description
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { textToDoc } from "../src/lib/tiptap-text";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.issue.findMany({
    // description 为数据库 NULL（JSON 过滤须用 DbNull，不能直写 null）
    where: { description: { equals: Prisma.DbNull }, descriptionText: { not: "" } },
    select: { id: true, number: true, descriptionText: true, project: { select: { name: true } } },
  });
  let backfilled = 0;
  for (const r of rows) {
    if (!r.descriptionText) continue;
    await prisma.issue.update({
      where: { id: r.id },
      data: { description: textToDoc(r.descriptionText) },
    });
    backfilled += 1;
    console.log(`✅ ${r.project.name} #${r.number}：description 已由 descriptionText 组装`);
  }
  console.log(`✅ 完成：回填 ${backfilled} 行（匹配 ${rows.length} 行）`);
}

main()
  .catch((e) => {
    console.error("❌ description 回填失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

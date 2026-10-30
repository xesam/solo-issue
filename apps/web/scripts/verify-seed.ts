// 验收数据准备（幂等）——补齐 prisma/seed.ts 未覆盖、但验收脚本/E2E 依赖的演示数据。
// 依赖盘点：
//   verify-agent 需要 工作区 main 下的项目 slug=demo，以及成员 wangwu@example.com
//   （dev-login 不自动建号，故必须在跑验收前预置）
//   e2e 需要「企微 mock 选人页」里的企业微信1/企业微信2（含 WECOM Identity 行）
// 用法：pnpm verify:seed（等价 pnpm tsx scripts/verify-seed.ts；seed 之后、起服务之前执行）
// 幂等：重复运行安全（upsert + 存在则跳过），不覆盖既有演示项目内容。
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_PROJECT_SLUG = process.env.DEMO_PROJECT ?? "demo";
const WANGWU_EMAIL = "wangwu@example.com";
// 与 prisma/seed.ts 同口径：管理员登录键参数化，占位回退
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "solo-issue@github.com").trim().toLowerCase();

// 默认 5 状态——与 src/server/services/project.ts 的 DEFAULT_STATES 同步维护
const DEFAULT_STATES = [
  { name: "待梳理", color: "#64748b", sequence: 15000, group: "ACTIVE" as const, isDefault: true },
  { name: "待办", color: "#64748b", sequence: 25000, group: "ACTIVE" as const, isDefault: false },
  { name: "进行中", color: "#f59e0b", sequence: 35000, group: "ACTIVE" as const, isDefault: false },
  { name: "已完成", color: "#22a559", sequence: 45000, group: "COMPLETED" as const, isDefault: false },
  { name: "已取消", color: "#94a3b8", sequence: 55000, group: "CANCELLED" as const, isDefault: false },
];

async function main() {
  const workspace = await prisma.workspace.findUnique({ where: { slug: "main" } });
  if (!workspace) throw new Error("工作区 main 不存在（请先 pnpm db:seed）");

  // 王五：verify-agent 的被通知人（MEMBER 即可）
  const wangwu = await prisma.user.upsert({
    where: { email: WANGWU_EMAIL },
    update: {},
    create: { email: WANGWU_EMAIL, name: "王五", origin: "EMAIL" },
  });
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: wangwu.id } },
    update: {},
    create: { workspaceId: workspace.id, userId: wangwu.id, role: "MEMBER" },
  });

  // E2E 登录身份：e2e/ 五条 spec 全走「企微 mock 选人页」以这两个名字登录，
  // 名单与 e2e/utils.ts 的 WECOM1/WECOM2 同步维护。口径 = 真实链路产物：
  // origin=WECOM、不写 email（D1/D2），且必须挂 WECOM Identity 行——
  // mock 登录按身份键解析（src/server/im/wecom/mock.ts），缺 Identity 行的号
  // 会被选人页列出但登录 404 mockIdentityMissing
  const E2E_WECOM_NAMES = ["企业微信1", "企业微信2"];
  for (const name of E2E_WECOM_NAMES) {
    let user = await prisma.user.findFirst({ where: { name, origin: "WECOM" } });
    if (!user) {
      user = await prisma.user.create({ data: { name, origin: "WECOM" } });
      console.log(`✅ 已创建 E2E 登录身份 ${name}`);
    }
    await prisma.identity.upsert({
      where: {
        provider_providerUserId: { provider: "WECOM", providerUserId: `mock:new:${name}` },
      },
      update: {},
      create: { userId: user.id, provider: "WECOM", providerUserId: `mock:new:${name}` },
    });
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      update: {},
      create: { workspaceId: workspace.id, userId: user.id, role: "MEMBER" },
    });
  }

  // demo 项目：verify-agent 的载体（不存在则建，并补默认状态；已存在则不动）
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) throw new Error(`管理员 ${ADMIN_EMAIL} 不存在（请先 pnpm db:seed）`);

  let project = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: DEMO_PROJECT_SLUG } },
  });
  if (!project) {
    project = await prisma.project.create({
      data: { workspaceId: workspace.id, slug: DEMO_PROJECT_SLUG, name: "演示项目" },
    });
    await prisma.state.createMany({
      data: DEFAULT_STATES.map((s) => ({
        projectId: project!.id,
        name: s.name,
        color: s.color,
        sequence: s.sequence,
        group: s.group,
        isDefault: s.isDefault,
      })),
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: admin.id, role: "ADMIN" },
    });
    console.log(`✅ 已创建演示项目 ${DEMO_PROJECT_SLUG}`);
  } else {
    console.log(`ℹ️  演示项目 ${DEMO_PROJECT_SLUG} 已存在，跳过`);
  }

  console.log(`✅ 验收数据就绪：工作区=main 项目=${DEMO_PROJECT_SLUG} 成员=${WANGWU_EMAIL}`);
}

main()
  .catch((e) => {
    console.error("❌ 验收数据准备失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

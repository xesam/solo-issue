// 建号（或更新既有用户显示名）并加入工作区（M1 开发用；M2 企微登录上线后自动建号）
// 语义：按 email 幂等——已存在的用户会更新显示名而非报错，误传既有邮箱等于改名，请核对
// 用法: pnpm add-user <email> <name> [workspaceSlug]
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [emailArg, nameArg, wsSlug = "main"] = process.argv.slice(2);

// 归一化前置守卫（与 main 内同口径）：纯空白入参在守卫前归一，防" "
// 被当成合法邮箱继续建号
const email = emailArg?.trim().toLowerCase();
const name = nameArg?.trim();
if (!email || !name) {
  console.error("用法: pnpm add-user <email> <name> [workspaceSlug]");
  process.exit(1);
}

async function main() {
  // 工作区校验前置：否则建号成功后才崩，留下没入工作区的半成品用户
  const workspace = await prisma.workspace.findUnique({ where: { slug: wsSlug } });
  if (!workspace) throw new Error(`工作区 ${wsSlug} 不存在`);

  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { name } })
    : await prisma.user.create({ data: { email, name, origin: "EMAIL" } });
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: {},
    create: { workspaceId: workspace.id, userId: user.id },
  });
  console.log(
    `${existing ? "ℹ️  用户已存在，显示名已更新" : "✅ 用户已创建"} ${email} 已就绪（工作区: ${wsSlug}）`,
  );
}

main()
  .catch((e) => {
    console.error("❌ 失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // 管理员登录键参数化：solo-issue@github.com 是仓库公开常量，硬编码会让
  // 每个部署的管理员登录键提前泄露给任何读过仓库的人。缺省回退占位邮箱——
  // verify-account / verify-smoke 等脚本与既有文档依赖它；空串/纯空白同样回退（compose 传空值的场景）
  const adminEmailRaw = process.env.ADMIN_EMAIL?.trim();
  const adminEmail = adminEmailRaw ? adminEmailRaw.toLowerCase() : "solo-issue@github.com";

  // 默认管理员（M2 企微登录上线后可绑定/停用；生产建议 ADMIN_EMAIL 定制 + 首登后管理台改名）。
  // 已有管理员时复用最早一位——按 email upsert 会在登录键被改为真实邮箱后，
  // 于下次 seed 另建一个占位邮箱的二号管理员；ADMIN_EMAIL 仅在尚无管理员时生效。
  let admin = await prisma.user.findFirst({ where: { isAdmin: true }, orderBy: { createdAt: "asc" } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { email: adminEmail, name: "管理员", isAdmin: true, origin: "EMAIL" },
    });
  }

  // 默认工作区（名称为落库数据：新部署呈现英文；既有库不改，需要时在管理端手工改名）
  const workspace = await prisma.workspace.upsert({
    where: { slug: "main" },
    update: {},
    create: { slug: "main", name: "Default workspace" },
  });

  // 管理员为工作区 OWNER
  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: workspace.id, userId: admin.id },
    },
    update: { role: "OWNER" },
    create: { workspaceId: workspace.id, userId: admin.id, role: "OWNER" },
  });

  // 生产引导：设置 ADMIN_INIT_PASSWORD 时为管理员设置初始密码（首登强制改密）
  const initPw = process.env.ADMIN_INIT_PASSWORD ?? undefined;
  if (initPw && !admin.passwordHash) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await hash(initPw, 10), mustChangePassword: true },
    });
    console.log("✅ 管理员初始密码已设置（首次登录需修改）");
  }

  console.log(`✅ Seed 完成: admin=${admin.email} workspace=${workspace.slug}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed 失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * 运维脚本：为指定用户设置密码（存量部署的密码引导 / 紧急恢复）
 * 用法：pnpm tsx scripts/ops-set-password.ts <email> [password]
 * 不传 password 则生成随机密码（要求用户首登改密）
 * 注意：无论传入还是生成，明文密码都会打到 stdout（便于人工转达）——
 *       勿在有终端回放/集中日志的环境运行
 */
import "dotenv/config";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();
const [email, pwArg] = process.argv.slice(2);

if (!email) {
  console.error("用法: pnpm tsx scripts/ops-set-password.ts <email> [password]");
  process.exit(1);
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`用户不存在: ${email}`);
  const pw = pwArg ?? "It@" + randomBytes(8).toString("base64url").slice(0, 10) + "X!";
  if (pw.length < 8) throw new Error("密码至少 8 位");
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(pw, 10), mustChangePassword: true },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log(`✅ 已为 ${email} 设置密码（首登强制改密）：${pw}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());

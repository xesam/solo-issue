import "dotenv/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 环境守卫：错失必提前红，并给出可操作修法
// （mature 原则：环境问题必须在 setup 阶段报出原因，不是让用例用一堆连接错误炸出）

if (!process.env.DATABASE_URL) {
  throw new Error(
    "集成测试需要 DATABASE_URL：请先复制 .env.example 为 .env 并指向本地 Postgres（参考根 README「快速开始」），或只跑 `pnpm test:unit`",
  );
}

// 附件存储沙箱：storage.ts 在模块加载时读 UPLOAD_DIR，必须在任何业务模块 import 前定值
process.env.UPLOAD_DIR ??= mkdtempSync(path.join(tmpdir(), "solo-issue-tests-"));

const { prisma } = await import("@/lib/prisma");
try {
  await prisma.$queryRaw`SELECT 1`;
} catch (e) {
  throw new Error(
    `集成测试无法连接数据库（DATABASE_URL 已设置但连接失败）：${(e as Error).message}。请确认 Postgres 已启动并完成 \`pnpm db:deploy && pnpm db:seed\``,
  );
}

import "dotenv/config";
import PgBoss from "pg-boss";
import { processImSend } from "@/server/services/im-send";
import { IM_SEND_QUEUE } from "@/server/queue";
import { prisma } from "@/lib/prisma";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[worker] 缺少 DATABASE_URL 环境变量");
  process.exit(1);
}

async function main() {
  const boss = new PgBoss({ connectionString });

  boss.on("error", (err) => console.error("[worker] pg-boss error:", err));

  await boss.start();
  console.log("[worker] pg-boss 已启动");

  await boss.createQueue(IM_SEND_QUEUE);

  // M4：消费 IM 通知任务（偏好过滤 → 身份解析 → 企微推送/模拟收件箱）
  await boss.work<{ notificationIds: string[]; locale?: "en" | "zh" }>(
    IM_SEND_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await processImSend(job.data);
        } catch (e) {
          console.error("[worker] 任务失败（将按 retryLimit 重试）:", job.id, e);
          throw e;
        }
      }
    },
  );
  console.log(`[worker] 消费中: ${IM_SEND_QUEUE}`);

  // 维护任务：清理过期会话（启动时 + 每小时）
  const purgeExpiredSessions = async () => {
    try {
      const r = await prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (r.count > 0) console.log(`[worker] 清理过期会话 ${r.count} 条`);
    } catch (e) {
      console.error("[worker] 会话清理失败:", e);
    }
  };
  await purgeExpiredSessions();
  const sessionTimer = setInterval(purgeExpiredSessions, 60 * 60 * 1000);

  const shutdown = async () => {
    clearInterval(sessionTimer);
    console.log("[worker] 正在停止…");
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] 启动失败:", err);
  process.exit(1);
});

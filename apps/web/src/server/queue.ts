import PgBoss from "pg-boss";

// pg-boss 队列单例（web 进程用）：复用 Prisma 同一个 Postgres，无额外中间件

type Boss = InstanceType<typeof PgBoss>;

const g = globalThis as unknown as { boss?: Promise<Boss> };

export function getBoss(): Promise<Boss> {
  // 缓存的是 in-flight 的 start promise 而非实例：并发首调若各自
  // new PgBoss + start，后写者覆盖成单例，先创建的实例永久泄漏连接池
  if (!g.boss) {
    const p = new PgBoss({
      connectionString: process.env.DATABASE_URL,
    }).start();
    // rejected 后清位、下次调用重试——否则发布时 DB 未起等一次性失败
    // 会让本进程内 IM 推送永久静默停摆（仅 console 留痕、无自恢复）
    p.catch(() => {
      if (g.boss === p) g.boss = undefined;
    });
    g.boss = p;
  }
  return g.boss;
}

export const IM_SEND_QUEUE = "notifications.im.send";

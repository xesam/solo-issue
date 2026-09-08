// 简单内存限流（单实例部署够用；多实例时换 Redis 实现）
// 用于：登录入口（dev-login / 企微 OAuth start/callback）防暴力尝试

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit = 10,
  windowMs = 60_000,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();

  // 顺手清理过期桶，防内存缓慢增长
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }

  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  b.count += 1;
  return {
    allowed: b.count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

/**
 * 客户端 IP（限流键）。
 * XFF / x-real-ip 是客户端可伪造的头。默认（未设置 TRUST_PROXY）维持采信
 * ——本系统 Docker Compose 部署通常位于内网/反向代理之后。
 * TRUST_PROXY=0 表示“直暴端口、前面没有可信代理”：头一律不采信，归为 unknown
 * （此时防暴力尝试的主力是登录路由的按邮箱桶，不受伪造影响；
 * 但注意：归 unknown 后全部匿名请求共享一个 IP 桶，务必还是走在反向代理后面）。
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === "0") return "unknown";
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

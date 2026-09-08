import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, rateLimit } from "@/server/rate-limit";

describe("rateLimit（登录入口内存限流）", () => {
  it("窗口内累计到上限放行，超限后拒绝并给 retryAfterSec", () => {
    const key = `k-${Math.random()}`;
    let r = rateLimit(key, 3, 60_000);
    expect(r.allowed).toBe(true);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true); // 第 3 次仍在限
    r = rateLimit(key, 3, 60_000); // 第 4 次
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("默认参数：10 次/分", () => {
    const key = `k2-${Math.random()}`;
    for (let i = 0; i < 9; i++) expect(rateLimit(key).allowed).toBe(true); // 前 9 次
    expect(rateLimit(key).allowed).toBe(true); // 第 10 次仍在限
    expect(rateLimit(key).allowed).toBe(false); // 第 11 次拒绝
  });

  it("不同 key 相互独立", () => {
    const a = `k3-${Math.random()}`;
    const b = `k4-${Math.random()}`;
    rateLimit(a, 1, 60_000);
    expect(rateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(rateLimit(b, 1, 60_000).allowed).toBe(true);
  });

  it("防泄漏清扫：超额过期桶触发清扫分支且新请求的限流窗口不受扰", () => {
    // 注：桶的删除是模块内内存操作、公开接口不可观测，此处锚定可观测面——
    // 清扫分支执行（size > 10_000）不影响新 key 的计数/拒绝曲线；删除本身由实现注释背书
    const bulkKey = `sweep-${Date.now()}-`;
    for (let i = 0; i < 10_001; i++) {
      rateLimit(`${bulkKey}${i}`, 10, -1); // 已过期窗口（resetAt 在过去）
    }
    const alive = `alive-${Math.random()}`;
    expect(rateLimit(alive, 2, 60_000).allowed).toBe(true);
    expect(rateLimit(alive, 2, 60_000).allowed).toBe(true);
    expect(rateLimit(alive, 2, 60_000).allowed).toBe(false);
  });
});

describe("clientIp（TRUST_PROXY 语义）", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://x/api/auth/login", { headers });

  afterEach(() => vi.unstubAllEnvs());

  it("缺省采信 XFF 首段，其次 x-real-ip，兜底 unknown", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("TRUST_PROXY=0：伪造头一律不采信，归 unknown", () => {
    vi.stubEnv("TRUST_PROXY", "0");
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
    expect(clientIp(req({ "x-real-ip": "3.3.3.3" }))).toBe("unknown");
  });
});

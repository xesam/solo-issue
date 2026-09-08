import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";

describe("sessionCookieOptions", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("会话 cookie 名与 30 天存活期固定", () => {
    expect(SESSION_COOKIE).toBe("it_session");
    expect(sessionCookieOptions().maxAge).toBe(30 * 86_400);
  });

  it("httpOnly + sameSite=lax + 全站 path 恒定", () => {
    const o = sessionCookieOptions();
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe("lax");
    expect(o.path).toBe("/");
  });

  it("开发环境不加密（可禁 Secure）", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieOptions().secure).toBe(false);
  });

  it("生产环境强制 Secure", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions().secure).toBe(true);
  });

  it("纯 HTTP 内网部署可显式放行（ALLOW_INSECURE_COOKIES=1）", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_COOKIES", "1");
    expect(sessionCookieOptions().secure).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE_PATH } from "@/lib/base-path";
import { prisma } from "@/lib/prisma";
import { MIN_MCP_VERSION } from "@/lib/api-contract";
import { hashToken } from "@/server/auth/hash";
import { TOKEN_PREFIX, createApiToken, verifyApiTokenRequest } from "@/server/auth/token";
import { bearerRequest, cleanupFixtures, mkUser, uid } from "./helpers";

// R3：Bearer 令牌通道全矩阵（401/403/429 + scope ∩ 角色）
// 与 AGENTS.md「Agent API 接入」段对齐：断言以状态码为准，不匹配文案原文

let user!: Awaited<ReturnType<typeof mkUser>>;

const expectHttpError = async (p: Promise<unknown>, status: number) => {
  try {
    await p;
    expect.unreachable(`应当 ${status}`);
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    expect((e as { status?: number }).status).toBe(status);
  }
};

beforeAll(async () => {
  user = await mkUser({ name: "令牌主" });
});

afterAll(cleanupFixtures);

describe("createApiToken（铸造）", () => {
  it("产出 itr_ 前缀明文与不含哈希的记录；expiry 按 30 天落库", async () => {
    const { token, record } = await createApiToken(user.id, {
      name: "巡检令牌",
      scopes: ["issues:read"],
      expiresInDays: 30,
    });
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(record.name).toBe("巡检令牌");
    expect("tokenHash" in record).toBe(false); // 哈希只入库不出库（TOKEN_FIELDS 白名单）
    const expiresAt = (record as { expiresAt?: Date }).expiresAt;
    expect(expiresAt && expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });

  it("缺省 expiresInDays = 永不过期", async () => {
    const { record } = await createApiToken(user.id, { name: "永生", scopes: ["*"] });
    expect((record as { expiresAt?: Date }).expiresAt).toBeNull();
  });

  it("服务层第二闸：绕过 zod 直调也拦未知 scope（422）", async () => {
    await expectHttpError(
      createApiToken(user.id, { name: "坏", scopes: ["issues:admin"] } as never),
      422,
    );
  });
});

describe("verifyApiTokenRequest（校验矩阵）", () => {
  const ISSUES_READ = "/api/projects/p1/issues";

  it("无 Authorization 头返回 null（回落会话通道）", async () => {
    expect(
      await verifyApiTokenRequest(new Request(`http://x${ISSUES_READ}`)),
    ).toBeNull();
  });

  it("scheme 大小写不敏感：小写 bearer 照常解析", async () => {
    const { token } = await createApiToken(user.id, { name: "t", scopes: ["issues:read"] });
    const r = await verifyApiTokenRequest(
      new Request(`http://x${ISSUES_READ}`, { headers: { authorization: `bearer ${token}` } }),
    );
    expect(r?.userId).toBe(user.id);
  });

  it("格式非法/未知/已吊销令牌一律 401", async () => {
    await expectHttpError(
      verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, "basic_creds")),
      401,
    );
    await expectHttpError(
      verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, `${TOKEN_PREFIX}nonexistent`)),
      401,
    );
    const { token } = await createApiToken(user.id, { name: "revoke-me", scopes: ["*"] });
    await prisma.apiToken.delete({ where: { tokenHash: hashToken(token) } });
    await expectHttpError(verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, token)), 401);
  });

  it("过期令牌 401；令牌所属用户被停用 401", async () => {
    const t1 = await createApiToken(user.id, { name: "exp", scopes: ["issues:read"], expiresInDays: 1 });
    await prisma.apiToken.update({
      where: { tokenHash: hashToken(t1.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expectHttpError(verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, t1.token)), 401);

    const dormant = await mkUser({ isActive: false });
    const t2 = await createApiToken(dormant.id, { name: "dormant", scopes: ["issues:read"] });
    await expectHttpError(verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, t2.token)), 401);
  });

  it("scope 缺失 403 且 params.scope 精确指出所需 scope", async () => {
    const { token } = await createApiToken(user.id, { name: "ro", scopes: ["issues:read"] });
    try {
      await verifyApiTokenRequest(bearerRequest("POST", "/api/projects/p1/issues", token));
      expect.unreachable();
    } catch (e) {
      expect((e as { status: number }).status).toBe(403);
      expect((e as { params?: { scope?: string } }).params?.scope).toBe("issues:write");
    }
  });

  it("basePath 部署形态：req.url 带前缀时豁免与禁区判定须先剥 BASE_PATH", async () => {
    const { token } = await createApiToken(user.id, { name: "bp", scopes: ["*"] });
    const pref = (path: string) => `http://x${BASE_PATH}${path}`;
    // 豁免端点带部署前缀仍生效（回归：此前 pathname 带前缀时 /api/meta 误 403，
    // MCP 启动自检整链条断）
    const meta = await verifyApiTokenRequest(
      new Request(pref("/api/meta"), { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(meta?.userId).toBe(user.id);
    // 禁区判定同样须剥前缀（admin 子树带资源段的路径从前只靠兜底 403）
    await expectHttpError(
      verifyApiTokenRequest(
        new Request(pref("/api/admin/workspaces"), { headers: { authorization: `Bearer ${token}` } }),
      ),
      403,
    );
  });

  it("Bearer 禁区（6 个前缀）一律 403——即便持有 * scope", async () => {
    const { token } = await createApiToken(user.id, { name: "star", scopes: ["*"] });
    const zones = [
      "/api/auth/me",
      "/api/api-tokens",
      "/api/mock/messages",
      "/api/workbench",
      "/api/notifications",
      "/api/admin/users",
    ];
    for (const path of zones)
      await expectHttpError(verifyApiTokenRequest(bearerRequest("GET", path, token)), 403);
  });

  it("无资源段路径对 Bearer 一并关闭（tokenResourceForbidden）", async () => {
    const { token } = await createApiToken(user.id, { name: "star", scopes: ["*"] });
    await expectHttpError(verifyApiTokenRequest(bearerRequest("GET", "/api/health", token)), 403);
    await expectHttpError(
      verifyApiTokenRequest(bearerRequest("GET", "/api/auth/logout", token)),
      403,
    );
  });

  it("mustChangePassword 只拦会话通道，不拦令牌通道（承诺行为）", async () => {
    const pending = await mkUser({ mustChangePassword: true });
    const { token } = await createApiToken(pending.id, { name: "pending", scopes: ["issues:read"] });
    const r = await verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, token));
    expect(r?.userId).toBe(pending.id);
  });

  it("频控：120 次/分钟内放行，第 121 次起 429 并带 Retry-After（AGENTS.md 承诺）", async () => {
    const hammer = await mkUser({ name: "压测令牌" });
    const { token } = await createApiToken(hammer.id, { name: "hammer", scopes: ["issues:read"] });
    // 前 120 次放行（每 token 独立窗口）
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      const r = await verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, token));
      expect(r?.userId).toBe(hammer.id);
    }
    try {
      await verifyApiTokenRequest(bearerRequest("GET", ISSUES_READ, token));
      expect.unreachable();
    } catch (e) {
      expect((e as { status: number }).status).toBe(429);
      const ra = (e as { headers?: Record<string, string> }).headers?.["Retry-After"];
      expect(ra && Number(ra)).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);
});

// token.ts 的 RATE_LIMIT_PER_MIN 为模块私有；120 次/分是 AGENTS.md 的对外承诺值，此处锚定
const RATE_LIMIT_PER_MIN = 120;

describe("X-Client 版本闸与 /api/meta 豁免（docs/11-mcp-adapter.md §5.2）", () => {
  const ISSUES_READ = "/api/projects/p1/issues";

  const reqWith = (path: string, token: string, xClient: string | null) =>
    new Request(`http://vitest.local${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, ...(xClient ? { "x-client": xClient } : {}) },
    });

  it("过旧 mcp 包的 X-Client 一律 426，先于查库（未知令牌同样 426）；params.min 指明升级目标", async () => {
    try {
      await verifyApiTokenRequest(
        reqWith(ISSUES_READ, `${TOKEN_PREFIX}nonexistent`, "solo-issue-mcp/0.0.0"),
      );
      expect.unreachable();
    } catch (e) {
      expect((e as { status?: number }).status).toBe(426);
      expect((e as { params?: { min?: string } }).params?.min).toBe(MIN_MCP_VERSION);
    }
  });

  it("不低于下限的 mcp 包头放行；无 X-Client / 异头请求不适用版本闸", async () => {
    const { token } = await createApiToken(user.id, { name: "mcp-current", scopes: ["issues:read"] });
    expect(
      (await verifyApiTokenRequest(reqWith(ISSUES_READ, token, `solo-issue-mcp/${MIN_MCP_VERSION}`)))
        ?.userId,
    ).toBe(user.id);
    expect((await verifyApiTokenRequest(reqWith(ISSUES_READ, token, null)))?.userId).toBe(user.id);
    expect((await verifyApiTokenRequest(reqWith(ISSUES_READ, token, "axios/1.7.0")))?.userId).toBe(
      user.id,
    );
  });

  it("/api/meta 豁免资源 scope（MCP 启动自检）：其余无资源段路径仍默认拒绝", async () => {
    const { token } = await createApiToken(user.id, { name: "meta-any", scopes: ["issues:read"] });
    expect((await verifyApiTokenRequest(reqWith("/api/meta", token, null)))?.userId).toBe(user.id);
    await expectHttpError(verifyApiTokenRequest(reqWith("/api/health", token, null)), 403);
  });
});

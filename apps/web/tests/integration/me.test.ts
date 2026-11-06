import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/me/route";
import { createApiToken } from "@/server/auth/token";
import { addMember, bearerRequest, cleanupFixtures, mkProject, mkUser, mkWorkspace } from "./helpers";

// /api/me（身份回吐）的 Bearer 快乐路径与 payload 形状。
// 边界分工：scope 豁免语义由 auth-token.test.ts 的豁免矩阵锚定（issues:read 最小令牌
// 可过 verifyApiTokenRequest；停用/无效 401 同为该矩阵既有语义——鉴权闸与路径无关）；
// 会话通道 200 与无凭证 401 由 verify-agent 端到端背书（handle 的 i18n 错误出口
// 依赖 Next 运行时，错误路径不在 vitest 层展开）

let who!: Awaited<ReturnType<typeof mkUser>>;
let owned!: Awaited<ReturnType<typeof mkWorkspace>>;
let joined!: Awaited<ReturnType<typeof mkWorkspace>>;

beforeAll(async () => {
  who = await mkUser({ name: "回显者" });
  owned = await mkWorkspace(who.id); // OWNER
  joined = await mkWorkspace(); // 后加入为 MEMBER
  await addMember(joined.id, who.id, "MEMBER");
  await mkProject(owned.id, who.id);
});

afterAll(cleanupFixtures);

describe("GET /api/me（身份回吐）", () => {
  it("issues:read 最小令牌 → 200：user 画像 + 双工作区（角色与项目数）", async () => {
    const { token } = await createApiToken(who.id, { name: "me-verify", scopes: ["issues:read"] });
    const res = await GET(bearerRequest("GET", "/api/me", token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user).toMatchObject({
      id: who.id,
      name: who.name,
      email: who.email,
      isAdmin: false,
    });
    // mustChangePassword 是会话态概念，不进 Agent 面
    expect(Object.keys(body.data.user)).not.toContain("mustChangePassword");
    const bySlug = new Map(
      (body.data.workspaces as { role: string; workspace: { slug: string; projectCount: number } }[]).map(
        (w) => [w.workspace.slug, w],
      ),
    );
    expect(bySlug.get(owned.slug)).toMatchObject({
      role: "OWNER",
      workspace: { projectCount: 1 },
    });
    expect(bySlug.get(joined.slug)).toMatchObject({
      role: "MEMBER",
      workspace: { projectCount: 0 },
    });
  });
});

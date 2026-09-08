import { describe, expect, it } from "vitest";
import { API_SCOPES } from "@/lib/scopes";
import { requiredScope, TOKEN_PREFIX } from "@/server/auth/token";

// scope 契约的事实源是 AGENTS.md「Agent API 接入」段；此处对齐实现。
describe("API_SCOPES 白名单", () => {
  it("集合与 AGENTS.md 承诺面一致（防漂移）", () => {
    expect([...API_SCOPES].sort()).toEqual(
      [
        "*",
        "issues:read",
        "issues:write",
        "comments:read",
        "comments:write",
        "search:read",
        "activities:read",
        "projects:read",
        "fields:read",
        "fields:write",
      ].sort(),
    );
  });

  it("每项形如 resource:read|write 或 *", () => {
    for (const s of API_SCOPES) {
      expect(s === "*" || /^[a-z]+:(read|write)$/.test(s), `scope "${s}" 形态非法`).toBe(true);
    }
  });
});

describe("requiredScope（资源=最后命中的白名单段，动作=方法）", () => {
  const cases: [string, string, string][] = [
    // AGENTS.md 与 token.ts 注释中的对账样例
    ["GET", "/api/workspaces/main/projects", "projects:read"],
    ["POST", "/api/projects/p1/issues", "issues:write"],
    ["GET", "/api/projects/p1/issues", "issues:read"],
    ["POST", "/api/projects/p1/issues/3/comments", "comments:write"],
    ["GET", "/api/projects/p1/issues/3/comments", "comments:read"],
    // 子资源随母资源
    ["GET", "/api/projects/p1/states", "projects:read"],
    ["POST", "/api/projects/p1/states", "projects:write"],
    ["GET", "/api/projects/p1/issues/3/activities", "issues:read"],
    ["GET", "/api/projects/p1/issues/3/attachments", "issues:read"],
    ["GET", "/api/search", "search:read"],
    // views：白名单外路径回退母资源（projects 段）
    ["GET", "/api/projects/p1/views", "projects:read"],
    ["POST", "/api/projects/p1/views", "projects:write"],
    // 批量端点
    ["POST", "/api/projects/p1/issues/batch", "issues:write"],
    // 深路径同样取最后命中段
    ["GET", "/api/projects/p1/issues/3/attachments/77", "issues:read"],
  ];
  it.each(cases)("%s %s → %s", (method, path, expected) => {
    expect(requiredScope(method, path)).toBe(expected);
  });

  it("HEAD 按 read 推导", () => {
    expect(requiredScope("HEAD", "/api/projects/p1/issues")).toBe("issues:read");
  });

  it("不含任何资源段的路径 → null（403 兜底，交由调用方报 errors.tokenResourceForbidden）", () => {
    for (const p of [
      "/api/auth/me",
      "/api/workbench",
      "/api/notifications",
      "/api/admin/users",
      "/api/api-tokens",
      "/api/mock/messages",
      "/api/health",
    ]) {
      expect(requiredScope("GET", p), `${p} 应无资源段`).toBeNull();
    }
  });

  it("前导 /api 与尾斜杠规格化", () => {
    expect(requiredScope("GET", "api/projects/p/issues")).toBe("issues:read");
    expect(requiredScope("GET", "///api//projects//p//issues///")).toBe("issues:read");
  });

  it("projects:write 不可授予（白名单外）：推导不误报（返回 scope 名，授权核对在 verify 层）", () => {
    const need = requiredScope("POST", "/api/workspaces/main");
    expect(need).toBe("projects:write");
    expect((API_SCOPES as readonly string[]).includes(need!)).toBe(false);
  });
});

describe("TOKEN_PREFIX", () => {
  it("令牌前缀固定 itr_", () => {
    expect(TOKEN_PREFIX).toBe("itr_");
  });
});

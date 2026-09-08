import { describe, expect, it } from "vitest";
import { ApiClient, withFieldFilters } from "../src/http";
import { ApiHttpError } from "../src/errors";

const cfg = { baseUrl: "http://t/solo-issue", token: "itr_x" };
const jsonRes = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

type Rec = { url?: string; init?: RequestInit };

describe("ApiClient（纯透传层）", () => {
  it("GET：Bearer + X-Client 头齐全，query 剔除 undefined/空串，{data} 剥壳", async () => {
    let seen: Rec = {};
    const api = new ApiClient(cfg, async (url, init) => {
      seen = { url: String(url), init };
      return jsonRes(200, { data: { projects: [] } });
    });
    const data = await api.get<{ projects: unknown[] }>("/api/workspaces/main/projects", {
      stateId: undefined,
      q: "",
      page: 2,
    });
    expect(data).toEqual({ projects: [] });
    expect(seen.url).toBe("http://t/solo-issue/api/workspaces/main/projects?page=2");
    const headers = seen.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer itr_x");
    expect(headers["x-client"]).toMatch(/^solo-issue-mcp\/\d+\.\d+\.\d+$/);
  });

  it("POST：JSON content-type + body 原样；错误抛 ApiHttpError（消息与 Retry-After 透传）", async () => {
    let seen: Rec = {};
    const api = new ApiClient(cfg, async (url, init) => {
      seen = { url: String(url), init };
      return jsonRes(429, { error: "too many" }, { "retry-after": "37" });
    });
    await expect(api.post("/api/projects/p1/issues", { title: "x" })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiHttpError &&
        e.status === 429 &&
        e.message === "too many" &&
        e.retryAfter === "37",
    );
    const headers = seen.init!.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(String(seen.init!.body)).toBe(JSON.stringify({ title: "x" }));
  });

  it("PATCH 通道与 GET 同一套剥壳语义（工具面无 DELETE 动词）", async () => {
    const api = new ApiClient(cfg, async () => jsonRes(200, { data: { ok: 1 } }));
    expect(await api.patch("/api/projects/p1/issues/3", { isArchived: true })).toEqual({ ok: 1 });
  });
});

describe("withFieldFilters（cf.<key> 转译）", () => {
  it("filters → cf.* 查询键，与固定参数合流", () => {
    expect(withFieldFilters({ severity: "s1" }, { q: "abc", page: 1 })).toEqual({
      q: "abc",
      page: 1,
      "cf.severity": "s1",
    });
  });
  it("无 filters 时固定参数原样", () => {
    expect(withFieldFilters(undefined, { q: "abc" })).toEqual({ q: "abc" });
  });
});

import { describe, expect, it } from "vitest";
import { ApiHttpError, errorResult, okResult } from "../src/errors";

describe("okResult", () => {
  it("data 序列化为 text content；null 兜底不产生 undefined 字符串", () => {
    expect(okResult({ a: 1 }).content[0]).toEqual({ type: "text", text: '{"a":1}' });
    expect(JSON.parse(okResult(null).content[0].text)).toBeNull();
  });
});

describe("errorResult（AGENTS.md §3 语义逐条对齐）", () => {
  const msg = (e: unknown) => (errorResult(e).content[0] as { text: string }).text;

  it("401/403/404/422/426/429 各带对应指引", () => {
    expect(msg(new ApiHttpError(401, "x"))).toMatch(/重新签发/);
    expect(msg(new ApiHttpError(403, "缺少权限范围: issues:write"))).toMatch(/不要重试/);
    expect(msg(new ApiHttpError(404, "x"))).toMatch(/不存在/);
    expect(msg(new ApiHttpError(422, "title: 必填"))).toMatch(/修正参数/);
    expect(msg(new ApiHttpError(426, "x"))).toMatch(/solo-issue-mcp@latest/);
    expect(msg(new ApiHttpError(429, "x", "12"))).toMatch(/Retry-After: 12s/);
  });

  it("5xx → 读退避 + 写操作先确认；未知状态兜底；非 HTTP 异常原样包装", () => {
    expect(msg(new ApiHttpError(503, "x"))).toMatch(/指.*退避/);
    expect(msg(new Error("boom"))).toMatch(/\[MCP\] boom/);
    // 兜底文案须被锁定：GUIDANCE 之外的状态码回落「请求失败」而非 undefined
    expect(msg(new ApiHttpError(418, "teapot"))).toContain("请求失败");
    expect(errorResult(new ApiHttpError(418, "teapot")).isError).toBe(true);
  });
});

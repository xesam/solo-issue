// api-server.handle 是全部路由的统一错误出口（key → 人话、status/headers 透传）。
// 翻译器 mock 为透传函数：断言契约（status/形状/headers），不夹带具体文案。
vi.mock("@/i18n/server", () => ({
  requestTranslator: async () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, parse } from "@/lib/api";
import { handle } from "@/lib/api-server";

describe("handle（统一错误出口）", () => {
  it("正常路径原样透传 Response", async () => {
    const res = await handle(async () => NextResponse.json({ ok: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("HttpError → 状态码与 headers 原样，message 走翻译链", async () => {
    const res = await handle(async () => {
      throw new HttpError(403, "errors.guestReadOnly", { "Retry-After": "3" });
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("Retry-After")).toBe("3");
    expect(await res.json()).toEqual({ error: "errors.guestReadOnly" });
    // 翻译链正锚：带 params 的 HttpError 必须经 translator 渲染——
    // handle 退化成直写 e.message（绕过翻译链）时，产物缺 params 段，此断言红
    const withParams = await handle(async () => {
      throw new HttpError(403, "errors.guestReadOnly", undefined, { scope: "issues:write" });
    });
    expect(await withParams.json()).toEqual({
      error: 'errors.guestReadOnly {"scope":"issues:write"}',
    });
  });

  it("parse 的 422（ValidationError）：顶层单字段去前缀，嵌套路径保留定位", async () => {
    const res = await handle(async () => {
      parse(
        z.object({ title: z.string(), fieldValues: z.object({ a: z.string() }) }),
        { title: 1, fieldValues: { a: 1 } },
      );
      return NextResponse.json({});
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    // 嵌套 issue 的渲染形如 "fieldValues.a: <msg>"；顶层 issue 的 msg 不带 path 前缀
    expect(body.error).toMatch(/fieldValues\.a:/);
    expect(body.error.split("; ").some((seg) => !seg.includes(": ") && seg.length > 0)).toBe(
      true,
    );
  });

  it("未知异常 → 500 + 服务端留痕（不向客户端透出内部信息）", async () => {
    const errSpy = vi.fn();
    vi.spyOn(console, "error").mockImplementation(errSpy);
    const res = await handle(async () => {
      throw new Error("prisma connection pool exhausted");
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(JSON.stringify(body)).not.toContain("prisma");
    // 留痕收紧：console.error 必须携带异常现场（服务端可核查；客户端响应不透出——
    // 上面那条 not.toContain 才管客户端）。退化成无参 console.error() 时空调用不红——
    // 这里要求至少有一个参数字符串含原始错误信息
    expect(errSpy).toHaveBeenCalled();
    expect(
      errSpy.mock.calls.some((c) => c.some((arg) => String(arg).includes("prisma"))),
    ).toBe(true);
    vi.restoreAllMocks();
  });
});

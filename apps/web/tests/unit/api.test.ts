import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  HttpError,
  ValidationError,
  fail,
  ok,
  parse,
  parseTimeCursor,
  readBody,
  requireIssueNumber,
} from "@/lib/api";

describe("API 响应约定", () => {
  it("ok() 包 { data }，fail() 包 { error }", async () => {
    const okRes = ok({ a: 1 }, 201);
    expect(okRes.status).toBe(201);
    expect(await okRes.json()).toEqual({ data: { a: 1 } });

    const failRes = fail("errors.x", 403);
    expect(failRes.status).toBe(403);
    expect(await failRes.json()).toEqual({ error: "errors.x" });
  });

  it("缺省状态码 200 / 400", async () => {
    expect(ok(1).status).toBe(200);
    expect(fail("errors.x").status).toBe(400);
  });
});

describe("parse()", () => {
  it("合法输入返回数据", () => {
    const schema = z.object({ n: z.number() });
    expect(parse(schema, { n: 1 })).toEqual({ n: 1 });
  });

  it("非法输入抛 ValidationError（422，携带 issues）", () => {
    const schema = z.object({ n: z.number() });
    try {
      parse(schema, { n: "x" });
      expect.unreachable("应当抛出");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).status).toBe(422);
      expect((e as ValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("readBody（CSRF 硬化）", () => {
  const url = "http://localhost/api/x";

  it("携 body 的方法遇非 JSON content-type 415（GET 系不在此路径——见实现 method 守卫）", async () => {
    const req = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    await expect(readBody(req)).rejects.toMatchObject({ status: 415 });
  });

  it("坏 JSON 报 400 而非静默空对象", async () => {
    const req = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    await expect(readBody(req)).rejects.toMatchObject({ status: 400 });
  });

  it("合法 JSON 返回解析结果", async () => {
    const req = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    await expect(readBody(req)).resolves.toEqual({ a: 1 });
  });
});

describe("requireIssueNumber（路径参数守卫）", () => {
  it("合法数字照常返回", () => {
    expect(requireIssueNumber("12")).toBe(12);
    expect(requireIssueNumber("2147483647")).toBe(2147483647);
  });

  it("非纯数字形态 404（Number() 会收编的 1e2/0x10/-5）", () => {
    for (const raw of ["1e2", "0x10", "-5", "abc", "", "1.5", " 12", "12 "]) {
      try {
        requireIssueNumber(raw);
        expect.unreachable(`"${raw}" 应当 404`);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpError);
        expect((e as HttpError).status).toBe(404);
      }
    }
  });

  it("Int32 边界外 404（防 Prisma 500）", () => {
    try {
      requireIssueNumber("2147483648");
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(404);
    }
    expect(requireIssueNumber("2147483647")).toBe(2147483647);
  });
});

describe("parseTimeCursor（复合游标）", () => {
  const qs = (s: string) => new URLSearchParams(s);
  const iso = new Date("2026-01-01T00:00:00Z").toISOString();

  it("双参齐全返回游标", () => {
    const cur = parseTimeCursor(qs(`before=${iso}&beforeId=abc`));
    expect(cur).toEqual({ before: new Date(iso), beforeId: "abc" });
  });

  it("缺一即 422（不完整游标不可用）", () => {
    expect(() => parseTimeCursor(qs(`before=${iso}`))).toThrowError(HttpError);
    expect(() => parseTimeCursor(qs("beforeId=abc"))).toThrowError(HttpError);
  });

  it("非法时间串 422", () => {
    expect(() => parseTimeCursor(qs("before=not-a-date&beforeId=abc"))).toThrowError(
      HttpError,
    );
  });

  it("双缺省返回 undefined（首页无游标）", () => {
    expect(parseTimeCursor(qs(""))).toBeUndefined();
  });
});

import { NextResponse } from "next/server";
import { ZodType, type ZodIssue } from "zod";
import type { Params } from "@/i18n/config";

// ── API 响应约定：成功 { data }，失败 { error } ──
// 错误消息为 i18n key（errors.*）：message 存 key、params 存插值，
// 出口（api-server.ts 的 handle）按请求 locale 转人话。
// 未显式 key 化的 zod 内置文案会经 en 未命中回退原样输出——新增校验应补 key。
// 本模块保持纯函数（可被 validations → 客户端组件传递引用，禁 import next/headers）

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    // i18n key（errors.*）；出口统一翻译，日志侧始终可见 key
    message: string,
    public headers?: Record<string, string>,
    public params?: Params,
  ) {
    super(message);
  }
}

// zod 422：携带原始 issues 到出口再渲染（消息 key 化后必须拿到 locale 才能转人话）
export class ValidationError extends HttpError {
  constructor(public issues: ZodIssue[]) {
    super(422, "errors.validation");
  }
}

export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues);
  return result.data;
}

export async function readBody(req: Request): Promise<unknown> {
  // CSRF 硬化：跨站表单无法携带 application/json，非 JSON 内容类型一律拒收
  // （multipart 上传路由不走 readBody，不受影响）
  const ct = req.headers.get("content-type") ?? "";
  if (req.method !== "GET" && !ct.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "errors.jsonOnly");
  }
  try {
    return await req.json();
  } catch {
    // 400 而非静默 {}：坏 JSON 若折成空对象，zod 只会报"缺字段"422，
    // 把 Agent/用户引向补参数而非修编码
    throw new HttpError(400, "errors.invalidJson");
  }
}

// ── 路径参数守卫：issue 序号必须是纯数字形态（"1e2"/"0x10" 会被 Number()
// 收编成同一 issue 的别形 URL）；合法数字但超出 Int32 也 404——
// 否则 2147483648 会被 Prisma 拒收炸成 500，正是这里要防的事。
// 页面路由（RSC）不能直接复用 throw 版：HttpError 未过 handle 会炸成 500，
// 故拆出纯解析版 parseIssueNumber，页面用其结果自行 notFound()
export function parseIssueNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n <= 0 || n > 2_147_483_647) return null;
  return n;
}

export function requireIssueNumber(raw: string): number {
  const n = parseIssueNumber(raw);
  if (n === null) throw new HttpError(404, "errors.issueNotFound");
  return n;
}

// 统一错误出口已迁至 src/lib/api-server.ts（import requestTranslator 需要
// next/headers，与本模块的客户端可引约束冲突）；路由层 import 断点见彼处注释

// ── 时间线复合游标（时间列, id）——评论/通知/工作台「加载更早」共用 ──
// 同一事务内多行时间戳相同（Postgres now() 事务稳定），必须带 id 决胜才能不重不漏；
// id 为 cuid 字典序，排序与游标用同一字典序。表格类列表不用它，用页码式（page/pageSize）。
export type TimeCursor = { before: Date; beforeId: string };

export function parseTimeCursor(sp: URLSearchParams): TimeCursor | undefined {
  const before = sp.get("before");
  const beforeId = sp.get("beforeId");
  if (!before && !beforeId) return undefined;
  const at = before ? new Date(before) : null;
  if (!at || Number.isNaN(at.getTime()) || !beforeId)
    throw new HttpError(422, "errors.cursorInvalid");
  return { before: at, beforeId };
}

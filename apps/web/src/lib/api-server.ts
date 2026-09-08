import { NextResponse } from "next/server";
import type { Params } from "@/i18n/config";
import { requestTranslator } from "@/i18n/server";
import { HttpError, ValidationError, fail } from "@/lib/api";

// 统一错误出口（仅 route handler 可引——携带 next/headers 依赖）：
// route 只需 `return handle(async () => {...})`。
// 消息闭环在此：key + params → 请求 locale 人话；status/headers 与 key 一起构成稳定契约

export async function handle(
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const t = await requestTranslator();
    if (e instanceof ValidationError) {
      // 顶层单字段错误直接给人话（旧版带 "title: " 前缀，对用户是噪音）；
      // 嵌套路径（fieldValues.x 等）保留定位信息
      const message = e.issues
        .map((i) => {
          const params = ((i as { params?: Params }).params ?? {}) as Params;
          return i.path.length > 1
            ? `${i.path.join(".")}: ${t(i.message, params)}`
            : t(i.message, params);
        })
        .join("; ");
      return NextResponse.json({ error: message }, { status: e.status });
    }
    if (e instanceof HttpError)
      return NextResponse.json(
        { error: t(e.message, e.params) },
        { status: e.status, headers: e.headers },
      );
    // 路由层一律经 parse()（其内部已把 ZodError 转 422 key），无裸 .parse() 直调
    console.error("[api] unhandled error:", e);
    return fail(t("errors.internal"), 500);
  }
}

import { z } from "zod";
import { ok, readBody, parse } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { LOCALE_COOKIE, LOCALES } from "@/i18n/config";

// 语言切换端点：仅写偏好 cookie，无副作用、无状态。
// 不设 httpOnly（客户端切换器刷新后可读），SameSite=Lax 防 CSRF 基线
export async function POST(req: Request) {
  return handle(async () => {
    const body = parse(
      z.object({ locale: z.enum(LOCALES, { errorMap: () => ({ message: "errors.invalidLocale" }) }) }),
      await readBody(req),
    );
    const res = ok({ locale: body.locale });
    res.cookies.set(LOCALE_COOKIE, body.locale, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  });
}

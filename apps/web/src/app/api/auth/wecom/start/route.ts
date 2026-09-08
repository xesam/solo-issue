import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requestTranslator } from "@/i18n/server";
import { getWecomProvider } from "@/server/im/wecom";
import { IM_STATE_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { withBase } from "@/lib/base-path";

export const dynamic = "force-dynamic";

// 发起企微登录：生成 state → 302 到授权页（mock 模式 → 站内模拟页）
export async function GET(req: Request) {
  return handle(async () => {
    const provider = await getWecomProvider();
    if (!provider) throw new HttpError(404, "errors.wecomNotConfigured");

    const rl = rateLimit(`wecom-start:${clientIp(req)}`, 20, 60_000);
    if (!rl.allowed)
      throw new HttpError(429, "errors.tooFrequent", undefined, { sec: rl.retryAfterSec });

    const state = randomBytes(16).toString("hex");
    const origin =
      process.env.APP_URL ?? new URL(req.url).origin;
    const t = await requestTranslator();
    // 真实模式下非企微客户端 UA 会被 provider 拒绝（HttpError）；
    // 登录入口是浏览器导航（302），错误必须重定向回登录页而不是裸 JSON
    let authUrl: string;
    try {
      authUrl = await provider.buildAuthUrl("in-app", {
        state,
        redirectUri: `${origin}/api/auth/wecom/callback`,
        userAgent: req.headers.get("user-agent") ?? undefined,
      });
    } catch (e) {
      if (e instanceof HttpError)
        // 跳回登录页带 error 提示。origin 必须用 APP_URL：
        // req.url 在容器内是 localhost:3000 视角，直接用会把用户带去
        // https://localhost:3000/...；且 /signin 需补 basePath
        return NextResponse.redirect(
          new URL(withBase(`/signin?error=${encodeURIComponent(t(e.message, e.params))}`), origin),
        );
      throw e;
    }

    // mock 模式返回站内相对路径（不带 basePath），同样需以 APP_URL 为基准拼接
    const res = authUrl.startsWith("/")
      ? NextResponse.redirect(new URL(withBase(authUrl), origin))
      : NextResponse.redirect(authUrl);
    res.cookies.set(IM_STATE_COOKIE, state, {
      ...sessionCookieOptions(),
      maxAge: 600, // 10 分钟内完成回调（覆盖 session 默认 30 天）
    });
    return res;
  });
}

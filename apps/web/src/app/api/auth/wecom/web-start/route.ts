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

// 发起 Web 登录（PC 系统浏览器 → wwlogin 扫码页；mock 模式 → 站内模拟页）。
// 与 start（企微内静默授权）为平行的双入口：URL 各自独立、限流独立；
// 两条流程殊途同归到同一 callback，靠 redirect_uri 的 flow=web 区分
export async function GET(req: Request) {
  return handle(async () => {
    const provider = await getWecomProvider();
    if (!provider) throw new HttpError(404, "errors.wecomNotConfigured");

    const rl = rateLimit(`wecom-web-start:${clientIp(req)}`, 20, 60_000);
    if (!rl.allowed)
      throw new HttpError(429, "errors.tooFrequent", undefined, { sec: rl.retryAfterSec });

    const state = randomBytes(16).toString("hex");
    const origin = process.env.APP_URL ?? new URL(req.url).origin;

    const t = await requestTranslator();
    let authUrl: string;
    try {
      authUrl = await provider.buildAuthUrl("web", {
        state,
        // flow=web 告知 callback 用哪个流程语境换身份（当前两者同接口，保留显式语义）
        redirectUri: `${origin}/api/auth/wecom/callback?flow=web`,
        userAgent: req.headers.get("user-agent") ?? undefined,
      });
    } catch (e) {
      if (e instanceof HttpError)
        return NextResponse.redirect(
          new URL(withBase(`/signin?error=${encodeURIComponent(t(e.message, e.params))}`), origin),
        );
      throw e;
    }

    const res = authUrl.startsWith("/")
      ? NextResponse.redirect(new URL(withBase(authUrl), origin))
      : NextResponse.redirect(authUrl);
    res.cookies.set(IM_STATE_COOKIE, state, {
      ...sessionCookieOptions(),
      maxAge: 600, // 10 分钟内完成回调
    });
    return res;
  });
}

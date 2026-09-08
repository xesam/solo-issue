import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requestTranslator } from "@/i18n/server";
import { getWecomProvider } from "@/server/im/wecom";
import { loginWithImIdentity } from "@/server/services/auth-im";
import {
  createSession,
  sessionCookieOptions,
  IM_STATE_COOKIE,
  SESSION_COOKIE,
} from "@/server/auth/session";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { withBase } from "@/lib/base-path";
import type { ImLoginFlow } from "@/server/im/types";

export const dynamic = "force-dynamic";

// origin 为 APP_URL（含 basePath），/signin、/ 需补全前缀才能落到真实路由
function redirectSignin(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(withBase(`/signin?error=${encodeURIComponent(message)}`), origin),
  );
}

// 企微登录回调：state 校验 → code 换身份 → 合并/建号 → 发会话
export async function GET(req: Request) {
  return handle(async () => {
    const t = await requestTranslator();
    const url = new URL(req.url);
    const origin = process.env.APP_URL ?? url.origin;
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return redirectSignin(origin, t("errors.wecomAuthParamsMissing"));

    const jar = await cookies();
    const savedState = jar.get(IM_STATE_COOKIE)?.value;
    if (!savedState || savedState !== state) {
      return redirectSignin(origin, t("errors.wecomStateInvalid"));
    }

    const rl = rateLimit(`wecom-callback:${clientIp(req)}`, 30, 60_000);
    if (!rl.allowed)
      return redirectSignin(origin, t("errors.tooFrequent", { sec: rl.retryAfterSec }));

    const provider = await getWecomProvider();
    if (!provider) return redirectSignin(origin, t("errors.wecomNotConfigured"));

    let identity;
    try {
      // 两条入口（start/web-start）殊途同归：flow 由 redirect_uri query 显式携带，
      // 缺省 in-app；两种流程的换身份接口一致（见 real.ts 实现说明）
      const flow = (url.searchParams.get("flow") ?? "in-app") as ImLoginFlow;
      identity = await provider.exchangeCode(flow, code);
    } catch (e) {
      // 不透传上游原始异常文案（可能含网络/配置细节），只给用户中性提示；
      // 但真实原因必须落服务端日志——否则联调排障只剩"用户登不上"一个表象
      console.error("[wecom] exchangeCode 失败:", e);
      return redirectSignin(origin, t("errors.wecomAuthFailed"));
    }

    let user;
    try {
      user = await loginWithImIdentity("WECOM", identity);
    } catch (e) {
      // 浏览器导航流程（GET → 302）：HttpError 也必须重定向回登录页，不能落成裸 JSON
      if (e instanceof HttpError) return redirectSignin(origin, t(e.message, e.params));
      throw e;
    }

    // 与 login/dev-login 同记录 ip：会话列表的设备信息才有完整语境
    const token = await createSession(user.id, {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    const res = NextResponse.redirect(new URL(withBase("/"), origin));
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    res.cookies.set(IM_STATE_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
    return res;
  });
}

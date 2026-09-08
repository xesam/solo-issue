import { ok, parse, readBody, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { devLoginSchema } from "@/lib/validations";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { clientIp, rateLimit } from "@/server/rate-limit";

// M1 开发登录：邮箱直登（无密码）。M2 企微登录上线后默认关闭。
// 开关：ALLOW_DEV_LOGIN 显式设置优先；否则非生产环境默认开、生产默认关。
function devLoginAllowed() {
  const flag = process.env.ALLOW_DEV_LOGIN;
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV !== "production";
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!devLoginAllowed()) throw new HttpError(403, "errors.devLoginDisabled");

    // 限流：防邮箱枚举/暴力尝试
    const rl = rateLimit(`dev-login:${clientIp(req)}`, 10, 60_000);
    if (!rl.allowed)
      throw new HttpError(429, "errors.tooFrequent", undefined, { sec: rl.retryAfterSec });

    const input = parse(devLoginSchema, await readBody(req));
    // 与 login 路由同口径（insensitive）：同一人大小写变体邮箱不应一处能登一处 404
    const user = await prisma.user.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
    });
    if (!user || !user.isActive) throw new HttpError(401, "errors.userNotFoundOrDisabled");

    const token = await createSession(user.id, {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    const res = ok({ id: user.id, name: user.name, email: user.email });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  });
}

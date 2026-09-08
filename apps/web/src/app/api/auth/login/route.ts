import { ok, parse, readBody, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { verifyPasswordTimingSafe } from "@/server/auth/password";
import { loginSchema } from "@/lib/validations";
import { clientIp, rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

// 密码登录：防账号枚举 + 限流 + 停用拦截

const GENERIC_ERROR = "errors.loginFailed";

export async function POST(req: Request) {
  return handle(async () => {
    // 双桶限流：IP 桶防扫射；邮箱桶是真正的暴力破解防线（IP 可被伪造/共旱，
    // 但猜密码必然针对特定账号）——XFF 在直暴端口下可伪造，邮箱桶不受其影响。
    const rl = rateLimit(`login:${clientIp(req)}`, 10, 60_000);
    if (!rl.allowed)
      throw new HttpError(429, "errors.tooFrequent", undefined, { sec: rl.retryAfterSec });
    const input = parse(loginSchema, await readBody(req));
    const rlEmail = rateLimit(`login-email:${input.email.toLowerCase()}`, 10, 60_000);
    if (!rlEmail.allowed)
      throw new HttpError(429, "errors.tooFrequent", undefined, { sec: rlEmail.retryAfterSec });
    // 限流桶按小写邮箱聚合，查询同样不区分大小写——否则大小写变体可分桶绕过邮箱限流
    const user = await prisma.user.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
    });

    const valid = await verifyPasswordTimingSafe(input.password, user?.passwordHash ?? null);

    if (!user || !valid) {
      throw new HttpError(401, GENERIC_ERROR); // 统一文案：不区分"用户不存在/密码错"
    }
    if (!user.isActive)
      throw new HttpError(403, "errors.accountDisabled"); // 密码已对，不泄露枚举面

    const token = await createSession(user.id, {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    const res = ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mustChangePassword: user.mustChangePassword,
      },
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  });
}

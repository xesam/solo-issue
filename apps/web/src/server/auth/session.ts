import { randomBytes } from "crypto";
import { hashToken } from "@/server/auth/hash";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

// 会话原语：DB 会话 + httpOnly Cookie（M2 企微登录沿用，仅换发放入口）

export const SESSION_COOKIE = "it_session";
// IM OAuth state 短期票据（start 写入 / callback 校验）
export const IM_STATE_COOKIE = "it_im_state";
const SESSION_DAYS = 30;

export async function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  return token;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    // 纯 HTTP 内网部署（无 TLS，浏览器无法携带 Secure cookie）时通过
    // ALLOW_INSECURE_COOKIES=1 放行；默认生产保持强制 Secure
    secure: process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_COOKIES !== "1",
    maxAge: SESSION_DAYS * 86_400,
  };
}

export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user.isActive) return null;
  return session.user;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .delete({ where: { id: hashToken(token) } })
      // 该行吞错是刻意的（登出体验不因 DB 抖动而 500），但必须留痕：
      // cookie 已清而 DB 会话仍有效 30 天，用户会以"我登出了"的认知蒙在鼓里
      .catch((e) => console.error("[session] 登出删除会话行失败（该会话在 DB 中可能仍有效）:", e));
  }
}

// U3.3：当前会话 id（无会话返回 null）
export async function getCurrentSessionId() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

// U3.3：吊销除当前外的全部会话（"全部登出"= 其他设备下线，保留当前登录）
export async function revokeOtherSessions(userId: string, currentId: string) {
  const res = await prisma.session.deleteMany({
    where: { userId, NOT: { id: currentId } },
  });
  return res.count;
}

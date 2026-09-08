import { ok, parse, readBody, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { getSessionUser, SESSION_COOKIE } from "@/server/auth/session";
import { hashToken } from "@/server/auth/hash";
import { changePassword, verifyPasswordTimingSafe } from "@/server/auth/password";
import { changePasswordSchema } from "@/lib/validations";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// 自助改密 / 首登强制改密：验证旧密码 → 更新 → 吊销其他会话

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await getSessionUser();
    if (!user) throw new HttpError(401, "errors.unauthenticated");
    // 无密码账号（IM 建号）不可改密：闸只看 passwordHash、不看 email——
    // 若收紧到"邮箱+密码双备"会把存量误重置过的 IM 账号锁死在强制改密重定向环里
    if (!user.passwordHash) throw new HttpError(403, "errors.noPasswordSet");

    const input = parse(changePasswordSchema, await readBody(req));

    const valid = await verifyPasswordTimingSafe(input.currentPassword, user.passwordHash);
    if (!valid) throw new HttpError(401, "errors.currentPasswordIncorrect");

    const jar = await cookies();
    // getSessionUser 已通过 ⇒ SESSION_COOKIE 必然存在（无 token 早退）——
    // 与 revoke-all 的非空断言同风格，不留不可达分支
    const token = jar.get(SESSION_COOKIE)!.value;
    await changePassword(user.id, input.newPassword, hashToken(token));

    return ok({ changed: true });
  });
}

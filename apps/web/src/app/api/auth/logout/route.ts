import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { SESSION_COOKIE, destroySession } from "@/server/auth/session";

export async function POST() {
  return handle(async () => {
    await destroySession();
    const res = ok({ success: true });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  });
}

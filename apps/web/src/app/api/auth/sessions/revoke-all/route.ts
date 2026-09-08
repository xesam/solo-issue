import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { getCurrentSessionId, revokeOtherSessions } from "@/server/auth/session";
import { requireApiUser } from "@/server/auth/access";

export const dynamic = "force-dynamic";

// U3.3：全部登出——吊销除当前会话外的全部会话（其他设备立即下线）

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    // requireApiUser 只经会话 cookie 通过（Bearer 在 /api/auth/* 禁区），当前会话必然存在
    const revoked = await revokeOtherSessions(user.id, (await getCurrentSessionId())!);
    return ok({ revoked });
  });
}

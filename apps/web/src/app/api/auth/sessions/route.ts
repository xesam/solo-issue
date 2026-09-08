import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { getCurrentSessionId } from "@/server/auth/session";
import { requireApiUser } from "@/server/auth/access";

export const dynamic = "force-dynamic";

// U3.3：我的登录设备列表（Session 表；当前会话高亮）

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const currentId = await getCurrentSessionId();
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ok(
      sessions.map((s) => ({
        id: s.id,
        current: s.id === currentId,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
    );
  });
}

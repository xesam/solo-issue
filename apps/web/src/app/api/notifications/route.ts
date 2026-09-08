import { ok, parseTimeCursor } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth/access";

export const dynamic = "force-dynamic";

// 我的通知：最近 50 条 + 未读数；?before=&beforeId= 复合游标加载更早
const NOTIFICATIONS_PAGE = 50;

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const cursor = parseTimeCursor(new URL(req.url).searchParams);

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId: user.id,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.before } },
                  { createdAt: cursor.before, id: { lt: cursor.beforeId } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: NOTIFICATIONS_PAGE + 1,
      }),
      prisma.notification.count({
        where: { userId: user.id, readAt: null },
      }),
    ]);

    const hasMore = rows.length > NOTIFICATIONS_PAGE;
    return ok({
      notifications: hasMore ? rows.slice(0, NOTIFICATIONS_PAGE) : rows,
      unreadCount,
      hasMore,
    });
  });
}

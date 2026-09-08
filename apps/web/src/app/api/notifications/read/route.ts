import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth/access";

export const dynamic = "force-dynamic";

const readSchema = z.object({
  ids: z.array(z.string()).max(100).optional(), // 指定 id；缺省 = 全部已读
});

// 标记已读（ids 为空数组/缺省 → 全部已读）
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const input = parse(readSchema, await readBody(req));

    const result = await prisma.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(input.ids?.length ? { id: { in: input.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return ok({ updated: result.count });
  });
}

import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth/access";
import { NOTIFICATION_TYPES, resolvePrefs } from "@/server/services/notification";

export const dynamic = "force-dynamic";

// 偏好：返回生效值（缺省项补全为 true）
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    // 项目级行 MVP 暂无 UI；null = 只解析全局行（resolvePrefs 的显式契约）
    const effective = await resolvePrefs(user.id, null);
    return ok({ prefs: effective, types: NOTIFICATION_TYPES });
  });
}

const prefsSchema = z.object({
  prefs: z.record(
    z.enum(NOTIFICATION_TYPES as [string, ...string[]]),
    z.object({ wecom: z.boolean() }),
  ),
});

// 保存全局偏好（projectId=null 的行；PG 对 NULL 复合键不强制唯一，见 schema 注释）。
// find→create 双发会产生重复全周行，这里事务内 advisory lock 按用户串行化：
// deleteMany + create 幂等收敛，顺带清理历史重复行。
export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const { prefs } = parse(prefsSchema, await readBody(req));

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('notif-pref:' || ${user.id}))`;
      await tx.notificationPreference.deleteMany({
        where: { userId: user.id, projectId: null },
      });
      await tx.notificationPreference.create({
        data: { userId: user.id, projectId: null, prefs },
      });
    });
    return ok(await resolvePrefs(user.id, null));
  });
}

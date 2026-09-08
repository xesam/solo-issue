import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireInstanceAdmin } from "@/server/auth/access";
import { adminUpdateUser } from "@/server/services/admin-user";
import { adminUpdateUserSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// 管理台：改姓名 / 改邮箱（登录键，归一化+查重）/ 停用启用 / 授撤超级管理员（护栏：最后一个活跃管理员）

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const { userId } = await params;
    const input = parse(adminUpdateUserSchema, await readBody(req));
    await adminUpdateUser(userId, input);
    return ok({ id: userId });
  });
}

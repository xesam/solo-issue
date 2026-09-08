import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireInstanceAdmin } from "@/server/auth/access";
import { adminSetWorkspaceRole } from "@/server/services/admin-user";
import { adminSetRoleSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// 管理台：设置/移除工作区角色（护栏：工作区最后一个 OWNER）

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const { userId } = await params;
    const input = parse(adminSetRoleSchema, await readBody(req));
    await adminSetWorkspaceRole(userId, input);
    return ok({ set: true });
  });
}

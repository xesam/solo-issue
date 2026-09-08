import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireInstanceAdmin } from "@/server/auth/access";
import { adminListWorkspaceMembers } from "@/server/services/admin-user";

export const dynamic = "force-dynamic";

// 管理台：工作区方向的成员视图（成员列表 + 可添加候选）。
// 写操作（加入/改角色/移除）复用 POST /api/admin/users/:id/roles，护栏同源。

export async function GET(
  req: Request,
  { params }: { params: Promise<{ wsId: string }> },
) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const { wsId } = await params;
    return ok(await adminListWorkspaceMembers(wsId));
  });
}

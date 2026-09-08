import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireWorkspace } from "@/server/auth/access";
import { listWorkspaceMembers } from "@/server/services/workspace";

export const dynamic = "force-dynamic";

// 工作区成员列表（负责人选择器用）
export async function GET(
  req: Request,
  { params }: { params: Promise<{ wsSlug: string }> },
) {
  return handle(async () => {
    const { wsSlug } = await params;
    await requireWorkspace(req, wsSlug);
    const members = await listWorkspaceMembers(wsSlug);
    return ok(members);
  });
}

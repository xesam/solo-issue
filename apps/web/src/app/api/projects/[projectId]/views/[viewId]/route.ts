import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProjectWrite } from "@/server/auth/access";
import { deleteView } from "@/server/services/view";

export const dynamic = "force-dynamic";

// U3.2：删除保存视图（MEMBER+；GUEST 只读）

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; viewId: string }> },
) {
  return handle(async () => {
    const { projectId, viewId } = await params;
    await requireProjectWrite(req, projectId);
    await deleteView(projectId, viewId);
    return ok({ deleted: true });
  });
}

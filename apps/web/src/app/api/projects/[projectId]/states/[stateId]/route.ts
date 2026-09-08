import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProjectAdmin } from "@/server/auth/access";
import { updateStateSchema } from "@/lib/validations";
import { deleteState, updateState } from "@/server/services/state";

export const dynamic = "force-dynamic";

// 状态是影响全项目的工作流定义（"项目设置"类操作）——
// 与字段定义同档：项目负责人 ∨ 工作区负责人
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; stateId: string }> },
) {
  return handle(async () => {
    const { projectId, stateId } = await params;
    await requireProjectAdmin(req, projectId);
    const input = parse(updateStateSchema, await readBody(req));
    return ok(await updateState(projectId, stateId, input));
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; stateId: string }> },
) {
  return handle(async () => {
    const { projectId, stateId } = await params;
    await requireProjectAdmin(req, projectId);
    await deleteState(projectId, stateId);
    return ok({ success: true });
  });
}

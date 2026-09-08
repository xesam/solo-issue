import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { updateCustomFieldSchema } from "@/lib/validations";
import { requireProjectAdmin } from "@/server/auth/access";
import {
  archiveCustomField,
  listFieldRevisions,
  updateCustomField,
} from "@/server/services/custom-field";

export const dynamic = "force-dynamic";

// PATCH：改名 / 改必填 / 改选项（软删语义）/ 排序。key、type 不可变。
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; fieldId: string }> },
) {
  return handle(async () => {
    const { projectId, fieldId } = await params;
    const { user } = await requireProjectAdmin(req, projectId);
    const input = parse(updateCustomFieldSchema, await readBody(req));
    return ok(await updateCustomField(projectId, fieldId, input, { id: user.id }));
  });
}

// DELETE：归档软删（历史值保留，表单不再出现）
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; fieldId: string }> },
) {
  return handle(async () => {
    const { projectId, fieldId } = await params;
    const { user } = await requireProjectAdmin(req, projectId);
    await archiveCustomField(projectId, fieldId, { id: user.id });
    return ok({ success: true });
  });
}

// GET：定义变更历史（轻量审计）
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; fieldId: string }> },
) {
  return handle(async () => {
    const { projectId, fieldId } = await params;
    await requireProjectAdmin(req, projectId);
    return ok(await listFieldRevisions(projectId, fieldId));
  });
}

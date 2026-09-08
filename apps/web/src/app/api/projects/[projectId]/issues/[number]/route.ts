import { requireIssueNumber, ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject, requireProjectAdmin, requireProjectWrite } from "@/server/auth/access";
import { updateIssueSchema } from "@/lib/validations";
import { deleteIssue, getIssue, updateIssue } from "@/server/services/issue";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    await requireProject(req, projectId);
    return ok(await getIssue(projectId, requireIssueNumber(number)));
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    const { user } = await requireProjectWrite(req, projectId);
    const input = parse(updateIssueSchema, await readBody(req));
    return ok(await updateIssue(projectId, requireIssueNumber(number), input, user));
  });
}

// 删除 issue：项目负责人 ∨ 工作区负责人；评论/活动/通知级联，附件连文件一并清理
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    await requireProjectAdmin(req, projectId);
    const num = requireIssueNumber(number);
    await deleteIssue(projectId, num);
    return ok({ deleted: true, number: num });
  });
}

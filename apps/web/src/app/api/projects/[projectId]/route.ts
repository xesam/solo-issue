import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject, requireProjectAdmin } from "@/server/auth/access";
import { updateProjectSchema } from "@/lib/validations";
import { getProjectById, updateProject, deleteProject } from "@/server/services/project";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProject(req, projectId);
    const project = await getProjectById(projectId);
    return ok(project);
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProjectAdmin(req, projectId);
    const input = parse(updateProjectSchema, await readBody(req));
    const project = await updateProject(projectId, input);
    return ok(project);
  });
}

// U2.3：删除项目（项目 ADMIN ∨ 工作区 OWNER + 空清护栏，见 deleteProject 服务）
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProjectAdmin(req, projectId);
    const project = await getProjectById(projectId);
    await deleteProject(projectId);
    return ok({ deleted: true, slug: project.slug });
  });
}

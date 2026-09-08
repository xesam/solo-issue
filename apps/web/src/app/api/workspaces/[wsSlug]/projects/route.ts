import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireWorkspace, requireWorkspaceAdmin } from "@/server/auth/access";
import { createProjectSchema } from "@/lib/validations";
import { createProject, listProjects } from "@/server/services/project";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ wsSlug: string }> },
) {
  return handle(async () => {
    const { wsSlug } = await params;
    const { user, workspace, member } = await requireWorkspace(req, wsSlug);
    const projects = await listProjects(workspace.id, { userId: user.id, role: member.role });
    return ok(projects);
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ wsSlug: string }> },
) {
  return handle(async () => {
    const { wsSlug } = await params;
    const { workspace, user } = await requireWorkspaceAdmin(req, wsSlug);
    const input = parse(createProjectSchema, await readBody(req));
    const project = await createProject(workspace.id, input, user.id);
    return ok(project, 201);
  });
}

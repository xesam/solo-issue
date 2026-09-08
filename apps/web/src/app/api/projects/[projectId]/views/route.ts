import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject, requireProjectWrite } from "@/server/auth/access";
import { createViewSchema } from "@/lib/validations";
import { createView, listViews } from "@/server/services/view";

export const dynamic = "force-dynamic";

// U3.2：保存视图（项目级）。读 = 项目可见成员；写 = MEMBER+（GUEST 只读）。

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProject(req, projectId);
    return ok(await listViews(projectId));
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    const { user } = await requireProjectWrite(req, projectId);
    const input = parse(createViewSchema, await readBody(req));
    return ok(await createView(projectId, input, user.id), 201);
  });
}

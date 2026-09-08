import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject, requireProjectAdmin } from "@/server/auth/access";
import { createStateSchema } from "@/lib/validations";
import { createState, listStates } from "@/server/services/state";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProject(req, projectId);
    return ok(await listStates(projectId));
  });
}

// 状态是影响全项目的工作流定义（"项目设置"类操作）——
// 与字段定义同档：项目负责人 ∨ 工作区负责人，而非任意可写成员
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProjectAdmin(req, projectId);
    const input = parse(createStateSchema, await readBody(req));
    const state = await createState(projectId, input);
    return ok(state, 201);
  });
}

import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { createCustomFieldSchema } from "@/lib/validations";
import { requireProject, requireProjectAdmin } from "@/server/auth/access";
import { createCustomField, listCustomFields } from "@/server/services/custom-field";

export const dynamic = "force-dynamic";

// 读取：项目可见成员即可（表单需要知道有哪些字段）
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProject(req, projectId);
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    return ok(await listCustomFields(projectId, includeArchived));
  });
}

// 创建：项目负责人（见 requireProjectAdmin）
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    const { user } = await requireProjectAdmin(req, projectId);
    const input = parse(createCustomFieldSchema, await readBody(req));
    return ok(await createCustomField(projectId, input, { id: user.id }), 201);
  });
}

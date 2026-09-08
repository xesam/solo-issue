import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject } from "@/server/auth/access";
import { fieldValuesJsonSchema } from "@/server/services/custom-field";

export const dynamic = "force-dynamic";

// 自描述 JSON Schema —— Agent 单个端点获取「本项目 fieldValues 能写什么」。
// 与 /api/projects/:id/fields 的区别：fields 是管理视图（含 id/审计等运维字段），
// schema 是面向机器消费的契约（可直接作为 tool-call 参数的 JSON Schema 校验器）。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProject(req, projectId);
    const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
    return ok(await fieldValuesJsonSchema(projectId, includeArchived));
  });
}

import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { importCustomFieldsSchema } from "@/lib/validations";
import { requireProjectAdmin } from "@/server/auth/access";
import { importCustomFields } from "@/server/services/custom-field";

export const dynamic = "force-dynamic";

// 按 key 增量合并导入（不删除已有字段；type 冲突跳过并回报）
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    const { user } = await requireProjectAdmin(req, projectId);
    const input = parse(importCustomFieldsSchema, await readBody(req));
    return ok(await importCustomFields(projectId, input, { id: user.id }));
  });
}

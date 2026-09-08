import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProjectWrite } from "@/server/auth/access";
import { batchUpdateIssueSchema } from "@/lib/validations";
import { batchUpdateIssues } from "@/server/services/issue";

export const dynamic = "force-dynamic";

// U3.1：批量更新（状态/指派/归档——优先级语义已迁自定义字段，不在批量面）。
// 逐条复用 updateIssue：Activity、通知引擎、指派护栏全部与单条编辑同构。
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    const { user } = await requireProjectWrite(req, projectId);
    const { numbers, patch } = parse(batchUpdateIssueSchema, await readBody(req));
    const result = await batchUpdateIssues(projectId, numbers, patch, user);
    // 部分失败仍返回 200：响应体带 failed 明细，由前端 toast 呈现
    return ok(result);
  });
}

import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProjectAdmin } from "@/server/auth/access";
import { exportCustomFields } from "@/server/services/custom-field";

export const dynamic = "force-dynamic";

// 导出字段定义为可移植 JSON（跨项目/跨环境复用）。
// 守卫有意为项目负责人（∨工作区 OWNER）而非普通成员：导出与导入（admin-only）
// 成对，是"迁移字段定义"的管理动作，不作为普通成员的批量带走默认能力。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProjectAdmin(req, projectId);
    return ok(await exportCustomFields(projectId));
  });
}

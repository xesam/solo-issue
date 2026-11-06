import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireApiUser } from "@/server/auth/access";
import { listMyWorkspaceSummaries } from "@/server/services/workspace";

export const dynamic = "force-dynamic";

// GET /api/me —— 身份回吐（06-api-contract.md §15）：令牌归属用户自画像 + 所属工作区，
// Bearer/会话双通道。面向 Agent 的 scope 豁免端点（token.ts SCOPE_EXEMPT_PATHS，与
// /api/meta 同档）：Agent 对齐「我是谁」与工作区发现的最小前提。与 /api/auth/me 的
// 分工——那边是会话壳（含 mustChangePassword 等 UI 态），本端点只回稳定画像
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    return ok({
      user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
      workspaces: await listMyWorkspaceSummaries(user.id),
    });
  });
}

import { ok, parseTimeCursor, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireApiUser } from "@/server/auth/access";
import { getWorkbench, WORKBENCH_TABS, type WorkbenchTab } from "@/server/services/workbench";

export const dynamic = "force-dynamic";

// 个人工作台：跨项目聚合（?tab=assigned|created；?before=&beforeId= 加载更早）
// mentioned 已并入工作台"通知" tab（复用 /api/notifications）

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const url = new URL(req.url);
    const tabParam = url.searchParams.get("tab") ?? "assigned";
    if (!WORKBENCH_TABS.includes(tabParam as WorkbenchTab)) {
      throw new HttpError(422, "errors.tabInvalid");
    }
    const wsParam = url.searchParams.get("ws") ?? undefined;
    const result = await getWorkbench(
      user.id,
      tabParam as WorkbenchTab,
      parseTimeCursor(url.searchParams),
      wsParam,
    );
    return ok(result);
  });
}

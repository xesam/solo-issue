import { requireIssueNumber, ok, parseTimeCursor } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject } from "@/server/auth/access";
import { listTimeline } from "@/server/services/timeline";

export const dynamic = "force-dynamic";

// 统一时间线：评论+活动混排（复合游标，缺省最近 TIMELINE_PAGE 条）
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    await requireProject(req, projectId);
    const url = new URL(req.url);
    return ok(await listTimeline(projectId, requireIssueNumber(number), parseTimeCursor(url.searchParams)));
  });
}

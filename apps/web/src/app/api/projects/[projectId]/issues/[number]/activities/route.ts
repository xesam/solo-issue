import { requireIssueNumber, ok, parseTimeCursor } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject } from "@/server/auth/access";
import { listIssueActivities } from "@/server/services/issue";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    await requireProject(req, projectId);
    const cursor = parseTimeCursor(new URL(req.url).searchParams);
    return ok(await listIssueActivities(projectId, requireIssueNumber(number), cursor));
  });
}

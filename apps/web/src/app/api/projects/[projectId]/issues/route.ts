import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject, requireProjectWrite } from "@/server/auth/access";
import { createIssueSchema, parseIssueQuery } from "@/lib/validations";
import { createIssue, listIssues } from "@/server/services/issue";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    await requireProject(req, projectId);
    const { filters, page, pageSize } = parseIssueQuery(new URL(req.url).searchParams);
    return ok(await listIssues(projectId, filters, page, pageSize));
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return handle(async () => {
    const { projectId } = await params;
    const { user } = await requireProjectWrite(req, projectId);
    const input = parse(createIssueSchema, await readBody(req));
    const issue = await createIssue(projectId, input, user);
    return ok(issue, 201);
  });
}

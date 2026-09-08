import { requireIssueNumber, ok, parse, readBody, parseTimeCursor } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireProject, requireProjectWrite } from "@/server/auth/access";
import { createCommentSchema } from "@/lib/validations";
import { createComment, listComments } from "@/server/services/comment";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    await requireProject(req, projectId);
    return ok(
      await listComments(
        projectId,
        requireIssueNumber(number),
        parseTimeCursor(new URL(req.url).searchParams),
      ),
    );
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    const { user } = await requireProjectWrite(req, projectId);
    const input = parse(createCommentSchema, await readBody(req));
    const comment = await createComment(projectId, requireIssueNumber(number), input.body, user);
    return ok(comment, 201);
  });
}

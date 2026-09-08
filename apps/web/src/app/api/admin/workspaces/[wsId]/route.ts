import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireInstanceAdmin } from "@/server/auth/access";
import { adminRenameWorkspace } from "@/server/services/admin-user";
import { renameWorkspaceSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// U2.2：重命名工作区（slug 不动——避免所有 /w/:slug 链接失效）
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ wsId: string }> },
) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const { wsId } = await params;
    const input = parse(renameWorkspaceSchema, await readBody(req));
    return ok(await adminRenameWorkspace(wsId, input.name));
  });
}

import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireApiUser } from "@/server/auth/access";
import { listMyWorkspaceSummaries } from "@/server/services/workspace";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    return ok({
      user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin, mustChangePassword: user.mustChangePassword },
      workspaces: await listMyWorkspaceSummaries(user.id),
    });
  });
}

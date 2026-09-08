import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireApiUser } from "@/server/auth/access";
import { listMyWorkspaces } from "@/server/services/workspace";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const memberships = await listMyWorkspaces(user.id);
    return ok({
      user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin, mustChangePassword: user.mustChangePassword },
      workspaces: memberships.map((m) => ({
        role: m.role,
        workspace: {
          id: m.workspace.id,
          slug: m.workspace.slug,
          name: m.workspace.name,
          projectCount: m.workspace._count.projects,
        },
      })),
    });
  });
}

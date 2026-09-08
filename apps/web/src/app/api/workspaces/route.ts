import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireApiUser } from "@/server/auth/access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// U2.1：我的工作区列表（会话或 Bearer 均可：projects:read 令牌可达），供侧边栏切换器使用。
// 只返回成员关系存在的工作区；角色供 UI 判断"可建项目"等。
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: {
        role: true,
        workspace: {
          select: { id: true, slug: true, name: true, _count: { select: { projects: true } } },
        },
      },
      orderBy: { joinedAt: "asc" },
    });
    return ok(
      memberships.map((m) => ({
        id: m.workspace.id,
        slug: m.workspace.slug,
        name: m.workspace.name,
        role: m.role,
        projectCount: m.workspace._count.projects,
      })),
    );
  });
}

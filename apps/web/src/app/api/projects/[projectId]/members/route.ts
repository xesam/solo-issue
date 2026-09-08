import { ok, parse, readBody, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { requireProject, requireProjectAdmin } from "@/server/auth/access";
import { listProjectMembers, upsertProjectMember, removeProjectMember } from "@/server/services/project";
import { upsertProjectMemberSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// 私有项目成员管理（项目设置 = 项目 ADMIN 或工作区 OWNER）

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await params;
    const { project } = await requireProject(req, projectId);
    if (!project.isPrivate) return ok([]);
    return ok(await listProjectMembers(projectId));
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await params;
    const { project } = await requireProjectAdmin(req, projectId);
    if (!project.isPrivate) throw new HttpError(422, "errors.membersPrivateOnly");
    const input = parse(upsertProjectMemberSchema, await readBody(req));
    // 成员必须先是工作区成员
    const wsMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: project.workspaceId, userId: input.userId },
    });
    if (!wsMember) throw new HttpError(422, "errors.notWorkspaceMember");
    await upsertProjectMember(projectId, input.userId, input.role);
    return ok(await listProjectMembers(projectId));
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return handle(async () => {
    const { projectId } = await params;
    const { project } = await requireProjectAdmin(req, projectId);
    // 与 POST 对称：公开项目不做成员管理（防止把唯一项目 ADMIN 摘除等旁路）
    if (!project.isPrivate) throw new HttpError(422, "errors.membersPrivateOnly");
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    if (!userId)
      throw new HttpError(422, "errors.missingField", undefined, { name: "userId" });
    await removeProjectMember(projectId, userId);
    return ok(await listProjectMembers(projectId));
  });
}

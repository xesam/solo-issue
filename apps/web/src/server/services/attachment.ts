import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { canWriteWithRoles, resolveProjectAccess } from "@/server/auth/project-visibility";
import {
  MAX_UPLOAD_BYTES,
  deleteFile,
  getFile,
  putFile,
  resolveKey,
} from "@/server/storage";

// 附件：本地磁盘存储（StorageAdapter），鉴权走 issue → project → workspace

export async function listAttachments(projectId: string, number: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number } },
    select: { id: true },
  });
  if (!issue) throw new HttpError(404, "errors.issueNotFound");
  return prisma.attachment.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: "desc" },
  });
}

export async function createAttachment(params: {
  projectId: string;
  number: number;
  uploaderId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const issue = await prisma.issue.findUnique({
    where: {
      projectId_number: { projectId: params.projectId, number: params.number },
    },
    select: { id: true },
  });
  if (!issue) throw new HttpError(404, "errors.issueNotFound");
  if (params.buffer.length > MAX_UPLOAD_BYTES)
    throw new HttpError(413, "errors.attachmentTooLarge");

  const key = resolveKey(issue.id, params.filename);
  await putFile(key, params.buffer);
  try {
    return await prisma.attachment.create({
      data: {
        issueId: issue.id,
        uploaderId: params.uploaderId,
        storageKey: key,
        filename: params.filename,
        size: params.buffer.length,
        mimeType: params.mimeType || "application/octet-stream",
      },
    });
  } catch (e) {
    // 文件已落盘但行写库失败（超时/约束）→ 回收文件，不留磁盘孤儿
    await deleteFile(key).catch(() => {});
    throw e;
  }
}

export async function readAttachment(id: string, userId: string) {
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) throw new HttpError(404, "errors.attachmentNotFound");
  // 404 语义（防枚举）：归属对象不可见时，附件与“不存在”不可区分
  const access = await resolveAttachmentAccess(att, userId);
  if (!access) throw new HttpError(404, "errors.attachmentNotFound");
  const buffer = await getFile(att.storageKey);
  return { att, buffer };
}

export async function removeAttachment(id: string, userId: string) {
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) throw new HttpError(404, "errors.attachmentNotFound");
  const access = await resolveAttachmentAccess(att, userId);
  if (!access) throw new HttpError(404, "errors.attachmentNotFound");
  // 删除是写操作：访客（工作区 GUEST / 私有项目内 GUEST）不可删
  if (!canWriteWithRoles(access.wsMemberRole, access.projectMemberRole))
    throw new HttpError(403, "errors.guestReadOnly");
  await prisma.attachment.delete({ where: { id } });
  await deleteFile(att.storageKey);
}

/**
 * 附件归属解析 + 项目可见性授权。
 * 旧版只验“工作区成员”——私有项目附件可被任意工作区成员凭 id 读取（越权），此处补上
 * resolveProjectAccess 同口径判定（公开项目仍仅要求工作区成员）。
 * 附件可挂 issue 或 comment（commentId 由评论图片路径预留），两者都解析到项目再统一判定。
 * 返回 null = 不可见（调用方按 404 处理）；返回角色信息供写权限复用。
 */
async function resolveAttachmentAccess(
  att: { issueId: string | null; commentId: string | null },
  userId: string,
): Promise<{ wsMemberRole: string; projectMemberRole: string | null } | null> {
  let project: { id: string; workspaceId: string; isPrivate: boolean } | null = null;
  if (att.issueId) {
    const issue = await prisma.issue.findUnique({
      where: { id: att.issueId },
      select: { project: { select: { id: true, workspaceId: true, isPrivate: true } } },
    });
    project = issue?.project ?? null;
  }
  if (!project && att.commentId) {
    const comment = await prisma.comment.findUnique({
      where: { id: att.commentId },
      select: { issue: { select: { project: { select: { id: true, workspaceId: true, isPrivate: true } } } } },
    });
    project = comment?.issue.project ?? null;
  }
  if (!project) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } },
    select: { role: true },
  });
  if (!member) return null;
  const access = await resolveProjectAccess(userId, project, member.role);
  if (!access) return null;
  return { wsMemberRole: member.role, projectMemberRole: access.projectMemberRole };
}

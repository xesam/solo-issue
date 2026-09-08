import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/api";

// U3.2：保存视图——过滤器/排序/搜索的命名快照
// query 存 IssueFilters 的 JSON 序列化；应用视图 = 前端逐 key 回写 URL 参数

export async function listViews(projectId: string) {
  return prisma.issueView.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    include: {
      createdBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });
}

export async function createView(
  projectId: string,
  input: { name: string; query: string },
  userId: string,
) {
  // 防呆：query 必须是合法 JSON 对象（前端传 JSON.stringify(filters)）
  try {
    const parsed = JSON.parse(input.query);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("not object");
  } catch {
    throw new HttpError(422, "errors.viewInvalid");
  }
  return prisma.issueView.create({
    data: {
      projectId,
      name: input.name,
      query: input.query,
      createdById: userId,
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });
}

export async function deleteView(projectId: string, viewId: string) {
  const view = await prisma.issueView.findUnique({ where: { id: viewId } });
  if (!view || view.projectId !== projectId) throw new HttpError(404, "errors.viewNotFound");
  await prisma.issueView.delete({ where: { id: viewId } });
}

import type { StateGroup } from "@prisma/client";
import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function listStates(projectId: string) {
  return prisma.state.findMany({
    where: { projectId },
    orderBy: { sequence: "asc" },
  });
}

export async function createState(
  projectId: string,
  input: { name: string; color?: string; group?: StateGroup },
) {
  const dup = await prisma.state.findUnique({
    where: { projectId_name: { projectId, name: input.name } },
  });
  if (dup) throw new HttpError(409, "errors.stateNameTaken");
  const last = await prisma.state.findFirst({
    where: { projectId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return prisma.state.create({
    data: {
      projectId,
      name: input.name,
      color: input.color ?? "#94a3b8",
      group: input.group ?? "ACTIVE",
      sequence: (last?.sequence ?? 5000) + 10000,
    },
  });
}

export async function updateState(
  projectId: string,
  stateId: string,
  input: { name?: string; color?: string; sequence?: number },
) {
  const state = await prisma.state.findUnique({ where: { id: stateId } });
  if (!state || state.projectId !== projectId)
    throw new HttpError(404, "errors.stateNotFound");
  // 重名预检与 create 路径对称：projectId_name 唯一约束撞上会以裸 P2002 变 500
  if (input.name && input.name !== state.name) {
    const dup = await prisma.state.findUnique({
      where: { projectId_name: { projectId, name: input.name } },
    });
    if (dup) throw new HttpError(409, "errors.stateNameTaken");
  }
  return prisma.state.update({ where: { id: stateId }, data: input });
}

// 删除状态：仅当其下无 issue 时允许（schema 层面 stateId 外键是 onDelete: SetNull，
// 但本守卫保证「带着存量 issue 删状态导致 stateId 批量置空」这条路径不会发生）
export async function deleteState(projectId: string, stateId: string) {
  const state = await prisma.state.findUnique({ where: { id: stateId } });
  if (!state || state.projectId !== projectId)
    throw new HttpError(404, "errors.stateNotFound");
  const count = await prisma.issue.count({ where: { stateId } });
  if (count > 0)
    throw new HttpError(409, "errors.stateInUse", undefined, { count });
  await prisma.state.delete({ where: { id: stateId } });
}

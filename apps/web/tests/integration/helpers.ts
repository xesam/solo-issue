import { randomUUID } from "node:crypto";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createProject } from "@/server/services/project";

// ── 集成测试 fixtures：自建自删，不触碰 seed/演示数据 ──
// 纪律（docs/10-testing.md §3）：
// - 唯一标识发生器（uid）全程带上 vitest 前缀 + 随机尾；绝不触碰/删除任何存量数据
// - 每个测试文件 afterAll 调 cleanupFixtures；泄露的行也轮不上第二轮帮忙清理

/** 唯一标识（字母+数字，适配 slug/email 约束） */
export const uid = (prefix: string) =>
  `${prefix}${randomUUID().replace(/-/g, "").slice(0, 16)}`;

// 清理登记簿：afterAll 统一删（先工作区级联子表，再用户级联会话/令牌）
const registeredUserIds = new Set<string>();
const registeredWorkspaceIds = new Set<string>();

/** 登记绕过 mkUser/mkWorkspace 直建的行（如 adminCreateUser/adminCreateWorkspace 的产物） */
export function trackUser(id: string) {
  registeredUserIds.add(id);
}
export function trackWorkspace(id: string) {
  registeredWorkspaceIds.add(id);
}

export async function mkUser(
  overrides: {
    name?: string;
    email?: string | null; // 显式 null = IM 建号无邮箱（不可被默认值覆盖）
    isActive?: boolean;
    isAdmin?: boolean;
    mustChangePassword?: boolean;
    passwordHash?: string | null;
  } = {},
) {
  const u = await prisma.user.create({
    data: {
      name: overrides.name ?? uid("用户"),
      email: "email" in overrides ? overrides.email! : `${uid("vitest")}@test.invalid`,
      origin: "EMAIL",
      passwordHash: overrides.passwordHash ?? null,
      isActive: overrides.isActive ?? true,
      isAdmin: overrides.isAdmin ?? false,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  });
  registeredUserIds.add(u.id);
  return u;
}

export async function mkWorkspace(leadUserId?: string, name?: string) {
  const ws = await prisma.workspace.create({
    data: { slug: uid("vtest-ws-"), name: name ?? uid("测试工作区") },
  });
  registeredWorkspaceIds.add(ws.id);
  if (leadUserId) await addMember(ws.id, leadUserId, "OWNER");
  return ws;
}

export async function addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  return prisma.workspaceMember.create({ data: { workspaceId, userId, role } });
}

/** 走 createProject 服务（建默认 5 状态 + creator 为项目 ADMIN），用私有/公共定制 */
export async function mkProject(
  workspaceId: string,
  actorId: string,
  opts: { name?: string; isPrivate?: boolean } = {},
) {
  return createProject(workspaceId, { name: opts.name ?? uid("测试项目"), isPrivate: opts.isPrivate }, actorId);
}

/** Bearer 请求构造（verifyApiTokenRequest / access 层直接吃 Request 对象） */
export function bearerRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown,
) {
  return new Request(`http://vitest.local${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** afterAll 钩子：自建自删（顺序：工作区级联 → 用户级联会话/令牌） */
export async function cleanupFixtures() {
  for (const id of registeredWorkspaceIds) {
    await prisma.workspace.delete({ where: { id } }).catch((e) => {
      console.error(`[fixture] 清理工作区 ${id} 失败:`, (e as Error).message);
    });
  }
  for (const id of registeredUserIds) {
    await prisma.user.delete({ where: { id } }).catch((e) => {
      console.error(`[fixture] 清理用户 ${id} 失败:`, (e as Error).message);
    });
  }
  registeredWorkspaceIds.clear();
  registeredUserIds.clear();
}

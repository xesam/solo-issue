import { ok, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth/access";
import { customFieldConditions } from "@/server/services/issue";
import { crossWorkspaceProjectVisibility } from "@/server/auth/project-visibility";

export const dynamic = "force-dynamic";

// 从查询串收集 cf.<key>=<value>（跨项目自定义字段过滤）
function collectCustomFilters(sp: URLSearchParams) {
  const out: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("cf.") && v !== "") {
      const key = k.slice(3);
      if (key) out[key] = v;
    }
  }
  return out;
}

/**
 * 跨项目自定义字段过滤：字段定义是项目级的，同一个 key 在不同项目类型可能不同。
 * 策略：按项目分组，各自用本地定义归一化后生成 JSONB 路径条件，项目间 OR（命中任一即算匹配）。
 * 无"幽灵命中"：项目组仅在**全部过滤键都被本项目定义为可检索（SELECT）**时参与——
 * 只定义部分 key、或把 key 定义为不可检索类型（TEXT 等）的项目整组排除，
 * 否则"按 A 过滤"会带出 A 命中但根本没定义 B 的项目里的无关 issue。
 * （项目内列表接口的"未定义 key 退化为不过滤"语义不适用于跨项目检索。）
 */
async function crossProjectFieldConditions(
  filters: Record<string, string>,
  projectIds: string[],
): Promise<Prisma.IssueWhereInput[]> {
  const requestedKeys = Object.keys(filters);
  if (!requestedKeys.length || !projectIds.length) return [];
  const defs = await prisma.customField.findMany({
    where: { projectId: { in: projectIds }, key: { in: requestedKeys }, isArchived: false },
    select: { projectId: true, key: true, type: true, settings: true },
  });
  const byProject = new Map<string, typeof defs>();
  for (const d of defs) {
    const arr = byProject.get(d.projectId) ?? [];
    arr.push(d);
    byProject.set(d.projectId, arr);
  }
  const groups: Prisma.IssueWhereInput[] = [];
  for (const [projectId, list] of byProject) {
    if (list.length !== requestedKeys.length) continue; // 部分定义 → 整组不匹配
    const and: Prisma.IssueWhereInput[] = [];
    for (const d of list) {
      // 可检索类型判定单源至 issue.ts（customFieldConditions）；
      // 不可检索类型返回空条件 → and 凑不齐 requestedKeys 数 → 整组排除
      and.push(...customFieldConditions(d, filters[d.key]));
    }
    if (and.length === requestedKeys.length) groups.push({ projectId, AND: and });
  }
  return groups;
}

// GET /api/search?q=关键词[&cf.<key>=<value>] —— 跨工作区全局搜索（issue）
// Agent 场景主入口：检索 issue 并返回深链所需全部上下文
// 支持按自定义字段过滤（issue）；返回 issue.fieldValues 供 Agent 消费
// 多字段之间：同一项目内的并集条件 AND，项目间 OR（字段定义是项目级的）
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") ?? "").trim();
    const customFilters = collectCustomFilters(sp);
    // 关键策略：带自定义字段过滤时允许省略 q（纯字段检索）；两者都空才报错
    if (!q && !Object.keys(customFilters).length)
      throw new HttpError(422, "errors.searchQueryRequired");

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { workspaceId: true, role: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);
    const fieldFilterApplied = Object.keys(customFilters).length > 0;
    if (!workspaceIds.length)
      // 形态对称：过滤场景也回显 appliedCustomFilters（空成员只可能是无过滤的空集）
      return ok({ issues: [], ...(fieldFilterApplied ? { appliedCustomFilters: customFilters, matchedFieldProjects: [] } : {}) });
    // 私有项目可见性：公开 ∪ 工作区负责人可见 ∪ 项目成员可见
    const projectVisibility = await crossWorkspaceProjectVisibility(user.id, memberships);

    // 先取可见项目 id（自定义字段过滤需按项目查定义）
    const visibleProjects = await prisma.project.findMany({
      where: { workspaceId: { in: workspaceIds }, ...projectVisibility },
      select: { id: true },
    });
    const visibleProjectIds = visibleProjects.map((p) => p.id);
    const fieldGroups = await crossProjectFieldConditions(customFilters, visibleProjectIds);
    // 带字段过滤但没有任何项目完整定义这些 key → 空集（不报错，语义上“无匹配”）

    const issues = await prisma.issue.findMany({
      where: {
        project: { workspaceId: { in: workspaceIds }, ...projectVisibility },
        isArchived: false,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { descriptionText: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(fieldFilterApplied
          ? { AND: [{ OR: fieldGroups.length ? fieldGroups : [{ id: "__none__" }] }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 20, // 显式上限：按 updatedAt 倒序取头部 20 条，无相关度排序、无分页；截断口径文档化于 docs/06 §10/§13 与 AGENTS.md search_everything
      select: {
        id: true,
        number: true,
        title: true,
        fieldValues: true,
        state: { select: { name: true, color: true } },
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            workspace: { select: { slug: true } },
          },
        },
      },
    })

    return ok({
      issues: issues.map((i) => ({
        ...i,
        ref: `${i.project.slug.toUpperCase()}-${i.number}`,
        url: `/w/${i.project.workspace.slug}/p/${i.project.slug}/issues/${i.number}`,
      })),
      // 回显生效的字段过滤，并给出「参与匹配（完整定义全部过滤键）的项目」
      // 的发现入口（Agent 拿到后 GET schemaUrl 即得该项目 fieldValues 的 JSON Schema）
      ...(fieldFilterApplied
        ? {
            appliedCustomFilters: customFilters,
            matchedFieldProjects: fieldGroups.map((g) => ({
              projectId: g.projectId,
              schemaUrl: `/api/projects/${g.projectId}/fields/schema`,
            })),
          }
        : {}),
    });
  });
}

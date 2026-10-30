import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { customFieldConditions } from "./issue";
import { crossWorkspaceProjectVisibility } from "@/server/auth/project-visibility";

// 跨工作区全局搜索（F2 / Agent search_everything 单源）：检索 issue 标题/描述 + 项目名。
// issue 侧固定上限 20（updatedAt 倒序）、项目侧 5（createdAt 倒序）——均无相关度排序、
// 无分页，截断口径文档化于 docs/06 §10/§13 与 AGENTS.md search_everything。
// 自定义字段过滤仅作用于 issue；项目组仅在 q 非空时参与（纯字段检索无关键词可匹配项目名）。

const ISSUE_LIMIT = 20;
const PROJECT_LIMIT = 5;

/**
 * 跨项目自定义字段过滤：字段定义是项目级的，同一个 key 在不同项目类型可能不同。
 * 策略：按项目分组，各自用本地定义归一化后生成 JSONB 路径条件，项目间 OR（命中任一即算匹配）。
 * 无"幽灵命中"：项目组仅在**全部过滤键都被本项目定义为可检索（SELECT）**时参与——
 * 只定义部分 key、或把 key 定义为不可检索类型（TEXT 等）的项目整组排除，
 * 否则"按 A 过滤"会带出 A 命中但根本没定义 B 的项目里的无关 issue。
 * （项目内列表接口的"未定义 key 退化为不过滤"语义不适用于跨项目检索。）
 */
/** 字段过滤命中组：IssueWhereInput 的具名子集（projectId 收窄为 string 供 schemaUrl 组装） */
type FieldFilterGroup = { projectId: string; AND: Prisma.IssueWhereInput[] };

async function crossProjectFieldConditions(
  filters: Record<string, string>,
  projectIds: string[],
): Promise<FieldFilterGroup[]> {
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
  const groups: FieldFilterGroup[] = [];
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

export interface SearchProjectHit {
  id: string;
  name: string;
  slug: string;
  workspace: { slug: string };
  url: string;
}

export interface SearchIssueHit {
  id: string;
  number: number;
  title: string;
  fieldValues: Prisma.JsonValue;
  state: { name: string; color: string } | null;
  project: { id: string; name: string; slug: string; workspace: { slug: string } };
  ref: string;
  url: string;
}

export interface SearchResults {
  projects: SearchProjectHit[];
  issues: SearchIssueHit[];
  // 以下仅在带字段过滤时出现：回显生效的过滤键 + 「完整定义全部过滤键的项目」
  // 的发现入口（Agent 拿到后 GET schemaUrl 即得该项目 fieldValues 的 JSON Schema）
  appliedCustomFilters?: Record<string, string>;
  matchedFieldProjects?: { projectId: string; schemaUrl: string }[];
}

/** q 与 customFilters 均由调用方保证非空（route 层 422 闸在此之上） */
export async function searchEverywhere(
  userId: string,
  input: { q: string; customFilters: Record<string, string> },
): Promise<SearchResults> {
  const q = input.q;
  const customFilters = input.customFilters;
  const fieldFilterApplied = Object.keys(customFilters).length > 0;

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspaceId: true, role: true },
  });
  const workspaceIds = memberships.map((m) => m.workspaceId);
  if (!workspaceIds.length)
    // 形态对称：空成员回空分组；过滤场景也回显 appliedCustomFilters（空成员只可能是无过滤的空集）
    return {
      projects: [],
      issues: [],
      ...(fieldFilterApplied
        ? { appliedCustomFilters: customFilters, matchedFieldProjects: [] }
        : {}),
    };
  // 私有项目可见性：公开 ∪ 工作区负责人可见 ∪ 项目成员可见
  const projectVisibility = await crossWorkspaceProjectVisibility(userId, memberships);

  // 先取可见项目 id（自定义字段过滤需按项目查定义；纯关键词搜索用不到，免查）
  const visibleProjectIds = fieldFilterApplied
    ? (
        await prisma.project.findMany({
          where: { workspaceId: { in: workspaceIds }, ...projectVisibility },
          select: { id: true },
        })
      ).map((p) => p.id)
    : [];
  const fieldGroups = await crossProjectFieldConditions(customFilters, visibleProjectIds);
  // 带字段过滤但没有任何项目完整定义这些 key → 空集（不报错，语义上“无匹配”）

  // 项目名检索：同一可见性公式（含私有项目），归档排除与 issue 侧一致
  const matchedProjects = q
    ? await prisma.project.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          ...projectVisibility,
          isArchived: false,
          name: { contains: q, mode: "insensitive" },
        },
        orderBy: { createdAt: "desc" },
        take: PROJECT_LIMIT,
        select: {
          id: true,
          name: true,
          slug: true,
          workspace: { select: { slug: true } },
        },
      })
    : [];

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
    take: ISSUE_LIMIT,
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
  });

  return {
    projects: matchedProjects.map((p) => ({
      ...p,
      url: `/w/${p.workspace.slug}/p/${p.slug}`,
    })),
    issues: issues.map((i) => ({
      ...i,
      ref: `${i.project.slug.toUpperCase()}-${i.number}`,
      url: `/w/${i.project.workspace.slug}/p/${i.project.slug}/issues/${i.number}`,
    })),
    ...(fieldFilterApplied
      ? {
          appliedCustomFilters: customFilters,
          matchedFieldProjects: fieldGroups.map((g) => ({
            projectId: g.projectId,
            schemaUrl: `/api/projects/${g.projectId}/fields/schema`,
          })),
        }
      : {}),
  };
}

import type { Prisma } from "@prisma/client";

// 客户端/服务端共用的查询片段与 DTO 类型（仅类型引用 @prisma/client，无运行时依赖）
// 注意：用 satisfies 保留字面量类型，GetPayload 才能推断出被 include 的字段

export const USER_LITE = {
  id: true,
  name: true,
  email: true,
  origin: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export const ISSUE_INCLUDE = {
  state: true,
  creator: { select: USER_LITE },
  assignees: { include: { user: { select: USER_LITE } } },
} satisfies Prisma.IssueInclude;

export type UserLite = Prisma.UserGetPayload<{ select: typeof USER_LITE }>;
export type IssueDTO = Prisma.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

// Issue 列表过滤条件（客户端与 API 共用）。
// 注意：只含过滤+排序，不含分页位置——保存视图（IssueFiltersBar.saveView）序列化
// 此对象时排除 q（关键词即时性太强，不进快照），分页属于“当时看到哪”的位置信息，不应进快照。
export type IssueFilters = {
  stateId?: string;
  assigneeId?: string;
  q?: string;
  archived?: boolean;
  // 自定义字段过滤（key → 原始字符串值，服务端按字段类型归一化后与 JSONB 等值比较）
  fieldValues?: Record<string, string>;
  orderBy?: "updatedAt" | "createdAt";
  orderDir?: "asc" | "desc";
};

// ── 分页常量与返回形态（页码式，服务端/客户端共用）──
export const ISSUE_PAGE_SIZE = 50; // 列表每页
export const BOARD_PAGE_SIZE = 500; // 看板不页码化：单次拉取上限，超限提示可用过滤器缩小

export type IssueListResult = {
  issues: IssueDTO[];
  total: number;
  page: number;
  pageSize: number;
};

export function issueFilterParams(f: IssueFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (f.stateId) params.stateId = f.stateId;
  if (f.assigneeId) params.assigneeId = f.assigneeId;
  if (f.q) params.q = f.q;
  if (f.archived !== undefined) params.archived = String(f.archived);
  // 自定义字段过滤进 URL：cf.<key>=<value>（前缀隔离命名空间，避免与固定参数碰撞）
  for (const [key, value] of Object.entries(f.fieldValues ?? {})) {
    // Object.entries 产出 [string, string]；空值与空键都拦（空键正常不可达，
    // 字段 key 受 [a-z][a-z0-9_]{0,39} 校验约束，为零防御）
    if (key && value !== "") params[`cf.${key}`] = value;
  }
  if (f.orderBy) params.orderBy = f.orderBy;
  if (f.orderDir) params.orderDir = f.orderDir;
  return params;
}

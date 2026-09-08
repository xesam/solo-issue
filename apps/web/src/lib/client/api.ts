"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { Attachment, Project, State, CustomField, FieldType } from "@prisma/client";
import type { JSONContent } from "@tiptap/core";
import type { IssueDTO, IssueFilters, IssueListResult, UserLite } from "@/lib/dto";
import { issueFilterParams } from "@/lib/dto";
import { withBase } from "@/lib/base-path";

// ── fetch 封装：统一 { data } / { error } 约定 ──

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBase(url), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(res.status, (json.error as string) ?? `Request failed (${res.status})`);
  return json.data as T;
}

export const apiGet = <T,>(url: string) => request<T>(url);
export const apiPost = <T,>(url: string, body?: unknown) =>
  request<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) });
export const apiPatch = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "PATCH", body: JSON.stringify(body) });
export const apiPut = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: "PUT", body: JSON.stringify(body) });
export const apiDelete = <T,>(url: string) =>
  request<T>(url, { method: "DELETE" });

// multipart 上传（附件）
export async function apiUpload<T>(url: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(withBase(url), { method: "POST", body: fd });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new ApiError(res.status, (json.error as string) ?? `Upload failed (${res.status})`);
  return json.data as T;
}

// ── 类型（JSON 序列化后 Date → string，字段以字符串运行时出现）──

// U3.6：项目卡 = 项目 + 问题计数 + 最新活动时间（侧边栏“新动静”徽标用）
type ProjectCard = Project & {
  _count: { issues: number };
  latestActivityAt: string | null;
};
export type MemberDTO = { id: string; role: string; user: UserLite };

// U2：我的工作区列表（侧边栏切换器）
type MyWorkspace = {
  id: string;
  slug: string;
  name: string;
  role: string;
  projectCount: number;
};

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces", "mine"],
    queryFn: () => apiGet<MyWorkspace[]>("/api/workspaces"),
  });
}

export function useProject(projectId: string | null) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ["project", projectId],
    queryFn: () => apiGet<Project>(`/api/projects/${projectId}`),
  });
}

// ── hooks ──

export function useProjects(wsSlug: string) {
  return useQuery({
    queryKey: ["projects", wsSlug],
    queryFn: () => apiGet<ProjectCard[]>(`/api/workspaces/${wsSlug}/projects`),
    // U2.4：项目治理（重命名/归档/删除）后需跨 slug 刷新（settings 里 invalidate）
  });
}

export function useMembers(wsSlug: string) {
  return useQuery({
    queryKey: ["members", wsSlug],
    queryFn: () => apiGet<MemberDTO[]>(`/api/workspaces/${wsSlug}/members`),
  });
}

// 可指派/可提及成员：镜像服务端 assertUsersVisible 规则——
// 公开项目 = 启用的工作区成员；私有项目 = ProjectMember ∪ 工作区负责人（OWNER）。
// 负责人、@提及、USER 自定义字段候选共用，避免出现“能选却提交 422”的错位。
export function useAssignableMembers(
  wsSlug: string,
  projectId: string,
  isPrivate: boolean,
) {
  const ws = useMembers(wsSlug);
  const pm = useQuery({
    queryKey: ["projectMembers", projectId],
    queryFn: () => apiGet<MemberDTO[]>(`/api/projects/${projectId}/members`),
    enabled: isPrivate,
  });
  const data = useMemo(() => {
    const wsMembers = ws.data ?? [];
    if (!isPrivate) return wsMembers;
    const visible = new Set((pm.data ?? []).map((m) => m.user.id));
    return wsMembers.filter(
      (m) => visible.has(m.user.id) || m.role === "OWNER",
    );
  }, [ws.data, pm.data, isPrivate]);
  return {
    data: ws.data === undefined ? undefined : data,
    isLoading: ws.isLoading || (isPrivate && pm.isLoading),
  };
}

export function useStates(projectId: string) {
  return useQuery({
    queryKey: ["states", projectId],
    queryFn: () => apiGet<State[]>(`/api/projects/${projectId}/states`),
  });
}

// ── 自定义字段 ──

export type CustomFieldOption = {
  value: string;
  label: string;
  color?: string;
  archived?: boolean;
};

export type CustomFieldSettings = {
  multiple?: boolean;
  notifyOn?: { values: string[]; notify: ("PROJECT_LEAD" | "FIELD_USERS")[] };
};

export type CustomFieldDTO = Omit<
  CustomField,
  "options" | "settings" | "createdAt" | "updatedAt"
> & {
  options: CustomFieldOption[] | null;
  settings: CustomFieldSettings | null;
  createdAt: string;
  updatedAt: string;
};

type CustomFieldDraft = {
  key: string;
  name: string;
  type: FieldType;
  options?: CustomFieldOption[];
  settings?: CustomFieldSettings;
  isRequired?: boolean;
  sequence?: number;
};

/** 字段定义：includeArchived 用于管理页（表单只取启用字段） */
export function useCustomFields(projectId: string, includeArchived = false) {
  return useQuery({
    queryKey: ["customFields", projectId, includeArchived],
    queryFn: () =>
      apiGet<CustomFieldDTO[]>(
        `/api/projects/${projectId}/fields${includeArchived ? "?archived=1" : ""}`,
      ),
  });
}

export function useCreateCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomFieldDraft) =>
      apiPost<CustomFieldDTO>(`/api/projects/${projectId}/fields`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customFields", projectId] }),
  });
}

export function useUpdateCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fieldId: string; patch: Partial<Omit<CustomFieldDraft, "key" | "type">> }) =>
      apiPatch<CustomFieldDTO>(`/api/projects/${projectId}/fields/${vars.fieldId}`, vars.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customFields", projectId] }),
  });
}

export function useArchiveCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fieldId: string) =>
      apiDelete<{ success: boolean }>(`/api/projects/${projectId}/fields/${fieldId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customFields", projectId] }),
  });
}

export function useImportCustomFields(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: CustomFieldDraft[]) =>
      apiPost<{ created: number; updated: number; skipped: { key: string; reason: string }[] }>(
        `/api/projects/${projectId}/fields/import`,
        { fields },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customFields", projectId] }),
  });
}

// 页码式分页。page 进 URL（刷新/分享/后退不丢，与排序同原则）；
// pageSize 不进 URL，由视图模式决定（列表 50 / 看板 500）
export function useIssues(
  projectId: string,
  filters: IssueFilters,
  page: number,
  pageSize: number,
) {
  const params = new URLSearchParams(issueFilterParams(filters));
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return useQuery({
    queryKey: ["issues", projectId, filters, page, pageSize],
    queryFn: () =>
      apiGet<IssueListResult>(`/api/projects/${projectId}/issues?${params}`),
  });
}

// U3.1：批量更新
export function useBatchUpdate(projectId: string) {
  const qc = useQueryClient();
  type BatchResult = {
    updated: number[];
    failed: { number: number; reason: string }[];
  };
  return useMutation({
    mutationFn: (vars: { numbers: number[]; patch: Record<string, unknown> }) =>
      apiPost<BatchResult>(`/api/projects/${projectId}/issues/batch`, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues", projectId] }),
  });
}

// U3.2：保存视图
export type ViewDTO = {
  id: string;
  name: string;
  query: string;
  createdAt: string;
  createdBy: { id: string; name: string; email: string | null; avatarUrl: string | null } | null;
};

export function useViews(projectId: string) {
  return useQuery({
    queryKey: ["views", projectId],
    queryFn: () => apiGet<ViewDTO[]>(`/api/projects/${projectId}/views`),
  });
}

export function useIssue(projectId: string, number: number, initialData?: IssueDTO) {
  return useQuery({
    queryKey: ["issue", projectId, number],
    queryFn: () => apiGet<IssueDTO>(`/api/projects/${projectId}/issues/${number}`),
    initialData,
    // 协作场景：别人改了这个 issue，详情页 30s 内跟上（dirty 编辑中不回写本地 state，见 IssueDetail）
    refetchInterval: 30_000,
  });
}

// ── 统一时间线（v1 合并流）：右栏对话面板的数据源，取代详情页对 comments/activities 两个查询的消费 ──
export type TimelineItemDTO =
  | {
      kind: "comment";
      id: string;
      createdAt: string;
      author: UserLite;
      body: unknown;
    }
  | {
      kind: "activity";
      id: string;
      createdAt: string;
      actor: UserLite | null;
      action: string;
      field: string | null;
      oldValue: unknown;
      newValue: unknown;
    };

type TimelineResult = {
  items: TimelineItemDTO[];
  hasMore: boolean;
  total: number;
};

export function useTimeline(projectId: string, number: number) {
  return useQuery({
    queryKey: ["timeline", projectId, number],
    queryFn: () =>
      apiGet<TimelineResult>(`/api/projects/${projectId}/issues/${number}/timeline`),
    refetchInterval: 30_000,
  });
}

export function fetchEarlierTimeline(
  projectId: string,
  number: number,
  cursor: { before: string; beforeId: string },
) {
  return apiGet<TimelineResult>(
    `/api/projects/${projectId}/issues/${number}/timeline?before=${encodeURIComponent(cursor.before)}&beforeId=${cursor.beforeId}`,
  );
}

export function useInvalidateTimeline(projectId: string, number: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["timeline", projectId, number] });
    qc.invalidateQueries({ queryKey: ["issues", projectId] }); // 评论动作会刷新列表 latestActivityAt
  };
}

export function useAttachments(projectId: string, number: number) {
  return useQuery({
    queryKey: ["attachments", projectId, number],
    queryFn: () =>
      apiGet<Attachment[]>(`/api/projects/${projectId}/issues/${number}/attachments`),
  });
}

// ── 通知（M4）──

export type NotificationDTO = {
  id: string;
  type: "ASSIGNED" | "MENTIONED" | "COMMENTED" | "STATE_CHANGED";
  title: string;
  body: string | null;
  url: string;
  readAt: string | null;
  createdAt: string;
};

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      apiGet<{ notifications: NotificationDTO[]; unreadCount: number; hasMore: boolean }>("/api/notifications"),
    // 实时性：10s 轮询兜底 + 切回窗口/切到通知 tab 时立即重拉（staleTime 0 覆盖全局 15s）
    staleTime: 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
}

// 游标拉更早的通知（复合游标见 lib/api.ts parseTimeCursor）
export function fetchEarlierNotifications(
  cursor: { before: string; beforeId: string },
) {
  return apiGet<{
    notifications: NotificationDTO[];
    unreadCount: number;
    hasMore: boolean;
  }>(`/api/notifications?before=${encodeURIComponent(cursor.before)}&beforeId=${cursor.beforeId}`);
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    // undefined = 全部已读；ids = 标记部分。空数组是无操作——
    // 服务端对 "ids 缺失" 解释为全部已读，直传 [] 会把误触的空选择放大成误杀全部
    mutationFn: (ids?: string[]) =>
      ids && !ids.length
        ? Promise.resolve({ updated: 0 })
        : apiPost<{ updated: number }>("/api/notifications/read", ids ? { ids } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

type PrefsDTO = Record<string, { wecom: boolean }>;

export function usePreferences() {
  return useQuery({
    queryKey: ["prefs"],
    queryFn: () => apiGet<{ prefs: PrefsDTO; types: string[] }>("/api/notifications/preferences"),
  });
}

export function useInvalidateIssue(projectId: string, number?: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["issues", projectId] });
    qc.invalidateQueries({ queryKey: ["issue", projectId, ...(number ? [number] : [])] });
    qc.invalidateQueries({ queryKey: ["timeline", projectId, ...(number ? [number] : [])] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
}

// IssueBoard / IssueFiltersBar / CustomFieldsTab 从此转发（不直接依赖 @tanstack 包）
export { useMutation, useQueryClient };

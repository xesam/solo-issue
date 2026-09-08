"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { IssueFilters } from "@/lib/dto";
import { BOARD_PAGE_SIZE, ISSUE_PAGE_SIZE } from "@/lib/dto";
import {
  useCustomFields,
  useIssues,
  useMembers,
  useStates,
} from "@/lib/client/api";
import IssueFiltersBar from "@/components/issues/IssueFiltersBar";
import PageHeader from "@/components/shell/PageHeader";
import IssueTable from "@/components/issues/IssueTable";
import IssueBoard from "@/components/issues/IssueBoard";
import BulkToolbar from "@/components/issues/BulkToolbar";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { IssueOrderField } from "@/lib/validations";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Settings2 } from "lucide-react";

function filtersFromParams(sp: URLSearchParams): IssueFilters {
  const f: IssueFilters = {};
  const stateId = sp.get("stateId");
  if (stateId) f.stateId = stateId;
  const assigneeId = sp.get("assigneeId");
  if (assigneeId) f.assigneeId = assigneeId;
  const q = sp.get("q");
  if (q) f.q = q;
  const archived = sp.get("archived");
  if (archived === "true") f.archived = true;
  else if (archived === "false") f.archived = false;
  const orderBy = sp.get("orderBy");
  if (orderBy) f.orderBy = orderBy as IssueFilters["orderBy"];
  const orderDir = sp.get("orderDir");
  if (orderDir) f.orderDir = orderDir as IssueFilters["orderDir"];
  // cf.<key> 收回自定义字段过滤
  const fieldValues: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("cf.") && v !== "") {
      const key = k.slice(3);
      if (key) fieldValues[key] = v;
    }
  }
  if (Object.keys(fieldValues).length) f.fieldValues = fieldValues;
  return f;
}

/** U1.4：列头排序——未激活列 → 默认降序；已激活列 → 升/降切换 */
function nextSort(
  field: IssueOrderField,
  cur?: IssueOrderField,
  dir?: "asc" | "desc",
): { orderBy: IssueOrderField; orderDir: "asc" | "desc" } {
  if (cur !== field) return { orderBy: field, orderDir: "desc" };
  return { orderBy: field, orderDir: dir === "desc" ? "asc" : "desc" };
}

function ProjectViewInner({
  wsSlug,
  projectId,
  projectSlug,
  projectName,
  canWrite,
}: {
  wsSlug: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("project");
  const sp = useSearchParams();
  const view = sp.get("view") === "board" ? "board" : "list";
  const filters = filtersFromParams(sp);
  // 页码进 URL（刷新/分享/后退不丢，与排序同原则）；过滤/排序变化时重置回第 1 页。
  // pageSize 不进 URL，由视图模式决定：列表 50 / 看板 500（看板不页码化，单次拉取上限+超限提示）
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = view === "board" ? BOARD_PAGE_SIZE : ISSUE_PAGE_SIZE;

  const issues = useIssues(projectId, filters, page, pageSize);
  const states = useStates(projectId);
  const members = useMembers(wsSlug);
  const customFields = useCustomFields(projectId);
  // 列开关持久化在 localStorage（每项目一份，纯展示偏好，不进 URL/不与他人共享）
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`cf-cols:${projectId}`);
      setHiddenColumns(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch {
      setHiddenColumns(new Set());
    }
  }, [projectId]);
  function toggleColumn(key: string) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(`cf-cols:${projectId}`, JSON.stringify([...next]));
      } catch {
        /* 隐私模式等场景忽略 */
      }
      return next;
    });
  }

  // U3.1：批量选择（列表 tab；过滤/排序变化后保留选择可能含隐藏行——操作前仍以勾选为准）
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggleSelect(n: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  // 全选 = 全选当前页；跨页已选的保留，再点一次则取消当前页勾选
  function toggleSelectAll() {
    const pageNums = (issues.data?.issues ?? []).map((i) => i.number);
    setSelected((prev) => {
      const allOnPage = pageNums.length > 0 && pageNums.every((n) => prev.has(n));
      if (allOnPage) {
        const next = new Set(prev);
        pageNums.forEach((n) => next.delete(n));
        return next;
      }
      return new Set([...prev, ...pageNums]);
    });
  }

  // patch 值允许 boolean（视图快照回放 archived），统一 String 化入 URL；fieldValues 展开为 cf.<key>
  function setParams(
    patch: Record<string, string | boolean | null | undefined | Record<string, string>>,
  ) {
    const next = new URLSearchParams(sp.toString());
    // 先清空既有 cf.*，避免自定义字段过滤器被整体替换时残留（onApplyView 还会显式清）
    if ("fieldValues" in patch) {
      for (const k of [...next.keys()]) if (k.startsWith("cf.")) next.delete(k);
      const fv = patch.fieldValues;
      if (fv) for (const [k, v] of Object.entries(fv)) next.set(`cf.${k}`, v);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (k === "fieldValues") continue;
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  function setFilter(key: keyof IssueFilters, value: string | Record<string, string> | null) {
    // 过滤/搜索变化 → 结果集变 → 回第 1 页
    setParams({ [key]: value as never, page: null });
  }

  const hasFilter = Boolean(
    filters.stateId ||
      filters.assigneeId ||
      filters.q ||
      filters.archived !== undefined ||
      (filters.fieldValues && Object.keys(filters.fieldValues).length > 0),
  );

  // 分页派生量；越界夹回（URL 手改/后退到已缩小的结果集时，空页无内容可看）
  const total = issues.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (issues.data && page > maxPage) {
      setParams({ page: maxPage === 1 ? null : String(maxPage) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.data, page, maxPage]);

  // U3.2：当前过滤器（含排序）序列化——保存视图的载荷

  return (
    <div className="px-8 py-6">
      {/* 标题行布局约定——「设置」紧贴项目名（不放行尾，隔整行难点击）；
          三个视图的「新增」统一在标题行右端同一位置（列表/看板=创建问题、页面=新建页面），
          视图私有操作（过滤器/搜索）留在下方工具栏行；项目名下不挂 /slug 地址行 */}
      <PageHeader
        title={projectName}
        titleClassName="truncate"
        className="mb-6 gap-x-4 gap-y-2"
        titleExtra={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => router.push(`/w/${wsSlug}/p/${projectSlug}/settings`)}
            title={t("projectSettings")}
            aria-label={t("projectSettings")}
          >
            <Settings2 className="size-4" />
          </Button>
        }
      >
        <Button onClick={() => router.push(`/w/${wsSlug}/p/${projectSlug}/issues/new`)}>
          <Plus className="size-4" />
          {t("createIssue")}
        </Button>
      </PageHeader>

      <Tabs
        value={view}
        onValueChange={(v) => setParams({ view: v === "list" ? null : v })}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="list">{t("viewList")}</TabsTrigger>
          <TabsTrigger value="board">{t("viewBoard")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <>
          <IssueFiltersBar
            projectId={projectId}
            filters={filters}
            states={states.data}
            members={members.data}
            onFilter={setFilter}
            onClear={() =>
              setParams({
                stateId: null,
                assigneeId: null,
                q: null,
                archived: null,
                fieldValues: null,
                orderBy: null,
                orderDir: null,
                page: null,
              })
            }
            onApplyView={(f) =>
              setParams({
                // 整体替换：先全清，再回放快照（避免残留旧参数）；fieldValues:null 清 cf.*；page 也归位第 1 页
                stateId: null,
                assigneeId: null,
                q: null,
                archived: null,
                fieldValues: null,
                orderBy: null,
                orderDir: null,
                page: null,
                ...f,
              })
            }
            hasFilter={hasFilter}
            canWrite={canWrite}
            customFields={customFields.data}
            hiddenColumns={hiddenColumns}
            onToggleColumn={toggleColumn}
          />

          {canWrite && selected.size > 0 && view === "list" && (
            <BulkToolbar
              projectId={projectId}
              numbers={[...selected]}
              states={states.data}
              members={members.data}
              onDone={() => setSelected(new Set())}
              onClear={() => setSelected(new Set())}
            />
          )}

          {issues.isLoading ? (
            <div className="space-y-1 overflow-x-auto rounded-xl border border-border bg-card p-4 shadow-sm">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-8 w-10 shrink-0" />
                  <Skeleton className="h-8 flex-1" />
                  <Skeleton className="h-8 w-16 shrink-0" />
                  <Skeleton className="h-8 w-14 shrink-0" />
                  <Skeleton className="h-8 w-20 shrink-0" />
                </div>
              ))}
            </div>
          ) : issues.error ? (
            <p className="py-10 text-center text-sm text-destructive">
              {(issues.error as Error).message}
            </p>
          ) : !issues.data?.issues.length ? (
            /* 空态二分：真·空项目给创建 CTA；过滤后清零则引导清除（工具栏「清除过滤」就在上方） */
            hasFilter ? (
              <div className="py-16 text-center">
                <p className="text-sm text-muted-foreground">{t("noMatchIssues")}</p>
              </div>
            ) : (
              <div className="py-16 text-center">
                <p className="text-sm text-muted-foreground">{t("emptyIssues")}</p>
                {canWrite && (
                  <Button
                    variant="link"
                    onClick={() => router.push(`/w/${wsSlug}/p/${projectSlug}/issues/new`)}
                    className="mt-3"
                  >
                    {t("createFirstIssue")}
                  </Button>
                )}
              </div>
            )
          ) : view === "list" ? (
            <>
            <IssueTable
              issues={issues.data.issues}
              wsSlug={wsSlug}
              projectSlug={projectSlug}
              orderBy={filters.orderBy}
              orderDir={filters.orderDir}
              canWrite={canWrite}
              selected={selected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              customFields={(customFields.data ?? []).filter((f) => !hiddenColumns.has(f.key))}
              onSort={(field) => {
                const next = nextSort(field, filters.orderBy, filters.orderDir);
                // 排序变化 → 回第 1 页
                setParams({ orderBy: next.orderBy, orderDir: next.orderDir, page: null });
              }}
            />
            {/* 页码式分页器（page 在 URL；与排序/过滤同享刷新还原） */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("totalCount", { count: total })}</span>
              <div className="flex items-center gap-2">
                <span>
                  {t("pageInfo", { page, total: maxPage })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={page <= 1 || issues.isFetching}
                  onClick={() =>
                    setParams({ page: page - 1 === 1 ? null : String(page - 1) })
                  }
                >
                  {t("prevPage")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={page >= maxPage || issues.isFetching}
                  onClick={() => setParams({ page: String(page + 1) })}
                >
                  {t("nextPage")}
                </Button>
              </div>
            </div>
            </>
          ) : (
            <>
            {/* 看板不页码化：单次拉最新 BOARD_PAGE_SIZE 条，超限提示用过滤器缩小 */}
            {issues.data.total > issues.data.issues.length && (
              <p className="mb-3 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("boardLimitHint", { pageSize: BOARD_PAGE_SIZE, total: issues.data.total })}
              </p>
            )}
            <IssueBoard
              issues={issues.data.issues}
              states={states.data ?? []}
              projectId={projectId}
              wsSlug={wsSlug}
              projectSlug={projectSlug}
            />
            </>
          )}
      </>
    </div>
  );
}

export default function ProjectView(props: {
  wsSlug: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  canWrite: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 px-8 py-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ProjectViewInner {...props} />
    </Suspense>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { State } from "@prisma/client";
import type { IssueFilters } from "@/lib/dto";
import type { CustomFieldDTO, MemberDTO } from "@/lib/client/api";
import { credentialHint } from "@/lib/origin-labels";
import { apiDelete, apiPost, useQueryClient, useViews, type ViewDTO } from "@/lib/client/api";
import { fieldTypeLabel } from "@/components/issues/custom-field-display";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label as UILabel } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Bookmark, Columns3, Plus, X } from "lucide-react";
import { toast } from "sonner";

// Radix Select 不允许 SelectItem value=""，用哨兵值映射"全部"
const ALL = "__all__";

function selectableOptions(f: CustomFieldDTO) {
  const opts = (f.options ?? []) as { value: string; label: string; archived?: boolean }[];
  return opts.filter((o) => !o.archived);
}

export default function IssueFiltersBar({
  projectId,
  filters,
  states,
  members,
  onFilter,
  onClear,
  onApplyView,
  hasFilter,
  canWrite,
  customFields,
  hiddenColumns,
  onToggleColumn,
}: {
  projectId: string;
  filters: IssueFilters;
  states: State[] | undefined;
  members: MemberDTO[] | undefined;
  onFilter: (key: keyof IssueFilters, value: string | Record<string, string> | null) => void;
  onClear: () => void;
  onApplyView: (f: Partial<IssueFilters>) => void;
  hasFilter: boolean;
  canWrite: boolean;
  // 自定义字段过滤 + 列开关
  customFields?: CustomFieldDTO[];
  hiddenColumns: Set<string>;
  onToggleColumn: (key: string) => void;
}) {
  const tr = useTranslations("issues");
  const trCommon = useTranslations("common");
  const trLabels = useTranslations("labels");
  const [q, setQ] = useState(filters.q ?? "");
  const views = useViews(projectId);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const qc = useQueryClient();
  const [colsOpen, setColsOpen] = useState(false);
  // 视图删除属不可逆操作，走 ConfirmDialog 二次确认（ui-guidelines §2）
  const [deletingView, setDeletingView] = useState<ViewDTO | null>(null);

  // 防抖竞态防线：闭包内的 filters.q 是快照值，服务端回显后旧快照会被误判
  // 「尚未同步」而重发 onFilter；以 ref 持有最新回显值
  const filtersQRef = useRef(filters.q ?? "");
  useEffect(() => {
    filtersQRef.current = filters.q ?? "";
  }, [filters.q]);

  // 自定义字段过滤——列开关用全量；过滤器仅 SELECT 可检索
  const filterableFields = customFields ?? [];
  // 可检索字段类型仅选项（SELECT）
  const searchableFields = filterableFields.filter((f) => f.type === "SELECT");
  function setCustomFilter(key: string, value: string | null) {
    const next = { ...(filters.fieldValues ?? {}) };
    if (value === null || value === "") delete next[key];
    else next[key] = value;
    onFilter("fieldValues", Object.keys(next).length ? next : null);
  }

  // U3.2：把当前 filters（含排序）序列化存库；q 不在内—关键词即时性太强，不进快照
  async function saveView() {
    if (!newViewName.trim()) return;
    const snapshot: Partial<IssueFilters> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (k !== "q" && v !== undefined && v !== null) (snapshot as Record<string, unknown>)[k] = v;
    }
    try {
      await apiPost(`/api/projects/${projectId}/views`, {
        name: newViewName.trim(),
        query: JSON.stringify(snapshot),
      });
    } catch (err) {
      // 名称/长度/schema 拒绝都要让用户看见并保留输入，否则等于"点了没反应"
      toast.error(err instanceof Error ? err.message : tr("viewSaveFailed"));
      return;
    }
    await qc.invalidateQueries({ queryKey: ["views", projectId] });
    setNewViewName("");
    toast.success(tr("viewSaved"));
  }

  // 关键词搜索防抖；外部清空/视图回放把 filters.q 变化回写进本地输入框，
  // 否则列表已解除过滤而搜索框还残留旧关键词（显示与数据矛盾）
  useEffect(() => {
    const t = setTimeout(() => {
      if (filtersQRef.current !== q) onFilter("q", q || null);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    // 回写仅在"本地没有待推送的新值"时，避免覆盖用户正在输入的内容
    if ((filters.q ?? "") !== q && !q.trim()) setQ(filters.q ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tr("searchPlaceholder")}
        className="h-8 w-44"
      />

      <Select
        value={filters.stateId ?? ALL}
        onValueChange={(v) => onFilter("stateId", v === ALL ? null : v)}
      >
        <SelectTrigger size="sm" className="w-28">
          <SelectValue placeholder={tr("allStates")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{tr("allStates")}</SelectItem>
          {states?.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.assigneeId ?? ALL}
        onValueChange={(v) => onFilter("assigneeId", v === ALL ? null : v)}
      >
        <SelectTrigger size="sm" className="w-32">
          <SelectValue placeholder={tr("allAssignees")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{tr("allAssignees")}</SelectItem>
          {members?.map((m) => {
            const hint = credentialHint(trLabels, m.user);
            return (
              <SelectItem key={m.user.id} value={m.user.id}>
                {m.user.name}
                {hint ? tr("memberHint", { hint }) : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* 自定义字段过滤器。可检索类型仅 SELECT（下拉，只列活跃选项） */}
      {searchableFields.map((f) => {
        const cur = filters.fieldValues?.[f.key] ?? "";
        const opts = selectableOptions(f);
        return (
          <Select
            key={f.id}
            value={cur === "" ? ALL : cur}
            onValueChange={(v) => setCustomFilter(f.key, v === ALL ? null : v)}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue placeholder={tr("allOfField", { name: f.name })} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr("allOfField", { name: f.name })}</SelectItem>
              {opts.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}

      <UILabel className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Checkbox
          checked={filters.archived === true}
          onCheckedChange={(c) => onFilter("archived", c ? "true" : null)}
        />
        {tr("archived")}
      </UILabel>

      {/* 列开关——控制列表页展示哪些自定义字段列（纯展示，不影响数据） */}
      {filterableFields.length > 0 && (
        <Popover open={colsOpen} onOpenChange={setColsOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Columns3 className="size-3.5" />
              {tr("columns")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2">
            <div className="px-1.5 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              {tr("fieldColumns")}
            </div>
            {filterableFields.map((f) => (
              <label
                key={f.id}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-accent"
              >
                <Checkbox
                  checked={!hiddenColumns.has(f.key)}
                  onCheckedChange={() => onToggleColumn(f.key)}
                />
                <span className="truncate">{f.name}</span>
                <span className="ml-auto text-xs text-muted-foreground/60">
                  {tr(fieldTypeLabel(f))}
                </span>
              </label>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {hasFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
          {tr("clearFilters")}
        </Button>
      )}

      {/* U3.2：保存视图——过滤器/排序/搜索的命名快照，点击即回放 */}
      <Popover open={viewsOpen} onOpenChange={setViewsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={tr("savedViews")}
            className="ml-auto gap-1.5"
          >
            <Bookmark className="size-3.5" />
            {tr("views")}
            {views.data?.length ? (
              <span className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                {views.data.length}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          <div className="px-1.5 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            {tr("savedViews")}
          </div>
          {views.error ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">{tr("viewLoadFailed")}</p>
          ) : views.data?.length ? (
            <ul className="mb-1 max-h-52 space-y-1 overflow-y-auto">
              {views.data.map((v) => (
                <li key={v.id} className="group flex items-center gap-1">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      // 坏快照不炸面板：schema 只保证 query 是字符串，不保证 JSON 合法
                      try {
                        onApplyView(JSON.parse(v.query) as Partial<IssueFilters>);
                      } catch {
                        toast.error(tr("viewCorrupted", { name: v.name }));
                      }
                      setViewsOpen(false);
                    }}
                  >
                    <Bookmark className="size-3.5 shrink-0 text-muted-foreground/50" />
                    <span className="truncate">{v.name}</span>
                  </button>
                  <button
                    aria-label={tr("deleteViewAria", { name: v.name })}
                    className="rounded-md p-1 text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={() => setDeletingView(v)}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">{tr("noViews")}</p>
          )}

          {canWrite && (
            <>
              <Separator className="my-1.5" />
              <div className="flex items-center gap-1.5 px-1.5 pb-1">
                <Input
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  placeholder={tr("saveViewPlaceholder")}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && saveView()}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 px-2 text-xs"
                  disabled={!newViewName.trim()}
                  onClick={saveView}
                >
                  <Plus className="size-3" />
                  {trCommon("save")}
                </Button>
              </div>
              <p className="px-1.5 text-xs leading-relaxed text-muted-foreground/70">
                {tr("viewHint")}
              </p>
            </>
          )}
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={deletingView !== null}
        title={tr("deleteViewTitle")}
        description={tr("deleteViewDesc", { name: deletingView?.name ?? "" })}
        confirmLabel={trCommon("delete")}
        destructive
        onConfirm={async () => {
          if (!deletingView) return;
          try {
            await apiDelete(`/api/projects/${projectId}/views/${deletingView.id}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : tr("viewDeleteFailed"));
            return;
          }
          await qc.invalidateQueries({ queryKey: ["views", projectId] });
          setDeletingView(null);
          toast.success(tr("viewDeleted"));
        }}
        onCancel={() => setDeletingView(null)}
      />
    </div>
  );
}

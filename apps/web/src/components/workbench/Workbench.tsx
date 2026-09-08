"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPut } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Avatar, StateBadge, fmtRelative } from "@/components/ui/bits";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Building2, ChevronRight, Coffee } from "lucide-react";
import {
  useNotifications,
  useMarkRead,
  fetchEarlierNotifications,
  usePreferences,
  type NotificationDTO,
} from "@/lib/client/api";
import { typeLabel } from "@/lib/notification-labels";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableShell } from "@/components/ui/table-shell";

// 个人工作台：待我处理 / 我创建的 / 通知
// 原「提及我」tab（MENTIONED 通知的工单级折叠视图）并入「通知」tab 的
// 类型筛选 chips；通知不再有常驻铃铛入口，工作台即通知中心。

type WBIssue = {
  id: string;
  number: number;
  title: string;
  updatedAt: string;
  state: { name: string; color: string; group: string } | null;
  assignees: { user: { id: string; name: string; email: string | null; avatarUrl: string | null } }[];
  project: {
    id: string;
    slug: string;
    name: string;
    workspace: { slug: string; name: string };
  };
};

// 复合游标分批拉（服务端每批 50 条 + hasMore/nextCursor）。
// stats 徽标一直是全量 count——旧版 take 100 静默截断导致徽标数与可见数错位，现在可拉全
type WorkbenchData = {
  issues: WBIssue[];
  stats: { assigned: number; created: number };
  hasMore: boolean;
  nextCursor: { before: string; beforeId: string } | null;
};

const TABS = ["assigned", "created", "notifications"] as const;

// 变体："me" = /me 个人工作台（三 tab，含通知中心）；
// "workspace" = 工作区落地页（仅两 tab，项目导航交给侧边栏，通知留在 /me）
const WORKSPACE_TABS = ["assigned", "created"] as const;

type TabKey = "assigned" | "created" | "notifications";

// 通知类型筛选（全部 + 四类型；「提及」即原「提及我」tab 的过滤态）
const NOTIF_FILTERS = [
  { key: "all", type: null },
  { key: "mention", type: "MENTIONED" },
  { key: "comment", type: "COMMENTED" },
  { key: "assign", type: "ASSIGNED" },
  { key: "state", type: "STATE_CHANGED" },
] as const;

export default function Workbench({
  wsScope,
  wsName,
  variant = "me",
  initialTab,
}: {
  wsScope?: string | null;
  wsName?: string | null;
  variant?: "me" | "workspace";
  /** 初值来源于计数卡深链 /me?tab=<key>（见 me/page.tsx），非法值由页面侧归一 */
  initialTab?: TabKey;
}) {
  const tabs: readonly TabKey[] = variant === "workspace" ? WORKSPACE_TABS : TABS;
  const [tab, setTab] = useState<TabKey>(initialTab ?? "assigned");
  const router = useRouter();
  const t = useTranslations("workbench");
  const tCommon = useTranslations("common");
  const wsParam = wsScope ? `&ws=${encodeURIComponent(wsScope)}` : "";

  // 徽标数量要求常显（含 0）：即使当前在「通知」tab 也保持 stats 拉取
  // （queryKey 归一到 assigned + ws 作用域，避免同 stats 双份缓存）
  const wb = useQuery({
    queryKey: ["workbench", tab === "notifications" ? "assigned" : tab, wsScope ?? null],
    queryFn: () =>
      apiGet<WorkbenchData>(
        `/api/workbench?tab=${tab === "notifications" ? "assigned" : tab}${wsParam}`,
      ),
    refetchInterval: 30_000,
  });

  // 追加态（切 tab 重置）；cursor 为空时用首屏 nextCursor 起步
  const [extra, setExtra] = useState<WBIssue[]>([]);
  const [cursor, setCursor] = useState<WorkbenchData["nextCursor"]>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setExtra([]);
    setCursor(null);
    setHasMore(false);
  }, [tab, wsScope]);

  const stats = wb.data?.stats;
  const list = [...(wb.data?.issues ?? []), ...extra];
  const canLoadMore = extra.length ? hasMore : (wb.data?.hasMore ?? false);

  async function loadMore() {
    const c = cursor ?? wb.data?.nextCursor ?? null;
    if (!c || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiGet<WorkbenchData>(
        `/api/workbench?tab=${tab}${wsParam}&before=${encodeURIComponent(c.before)}&beforeId=${c.beforeId}`,
      );
      setExtra((prev) => {
        const seen = new Set([
          ...(wb.data?.issues ?? []).map((i) => i.id),
          ...prev.map((i) => i.id),
        ]);
        return [...prev, ...res.issues.filter((i) => !seen.has(i.id))];
      });
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("loadMoreFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  function openIssue(i: WBIssue) {
    router.push(
      `/w/${i.project.workspace.slug}/p/${i.project.slug}/issues/${i.number}`,
    );
  }

  function goWorkspace(slug: string) {
    router.push(`/me?ws=${slug}`);
  }

  // 通知 tab 的未读徽章（10s 轮询，与 tab 内容同源；useNotifications 定义处为准）
  const { data: notifData } = useNotifications();
  const unread = notifData?.unreadCount ?? 0;

  return (
    <div>
      {/* 页头职责已上移（账号壳：身份锚点 + 计数卡）；此处直接进入作用域声明 + tab 导航 */}

      {/* 作用域声明（验收点 2，仅 /me 变体）：工作区收窄态显式可见、可退回全局；
          workspace 变体（/w/[wsSlug]）不渲染——侧栏工作区切换器已是显式语境，此条冗余 */}
      {wsScope && variant === "me" && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm">
          <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-foreground/80">
            {t("currentWorkspace")}<span className="font-medium">{wsName ?? wsScope}</span>
          </span>
          <button
            type="button"
            onClick={() => router.push("/me")}
            className="ml-auto rounded-md text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("viewAllWorkspaces")}
          </button>
        </div>
      )}

      {/* Tab 导航 + 计数徽标 */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((tb) => {
          const count =
            tb === "assigned"
              ? stats?.assigned
              : tb === "created"
                ? stats?.created
                : unread;
          // 徽标常显：没有数据时先渲染占位（保持高度一致），拿到后含 0 也显示
          const active = tab === tb;
          return (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tabs.${tb}`)}
              {/* 徽标样式统一：不高亮，与文案同为 muted */}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {count === undefined ? "–" : count > 99 ? "99+" : count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "notifications" ? (
        <NotificationsTab />
      ) : wb.isLoading ? (
        <div className="space-y-1 rounded-xl border border-border p-4" aria-label={tCommon("loading")}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 w-20 shrink-0" />
              <Skeleton className="h-9 w-16 shrink-0" />
            </div>
          ))}
        </div>
      ) : wb.isError ? (
        <p className="py-10 text-sm text-destructive">
          {(wb.error as Error)?.message ?? t("loadFailed")}
        </p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          {tab === "assigned" && (
            <span className="inline-flex flex-col items-center gap-2">
              <Coffee className="size-6 text-muted-foreground/50" aria-hidden />
              {t("emptyAssigned")}
            </span>
          )}
          {tab === "created" && t("emptyCreated")}
        </div>
      ) : (
        <IssueTable list={list} onOpen={openIssue} onGoWorkspace={goWorkspace} />
      )}

      {/* 复合游标加载更早（徽标 count 是全量，列表可拉齐） */}
      {tab !== "notifications" && canLoadMore && !wb.isLoading && (
        <div className="mt-3 flex justify-center">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t("loadingInProgress") : t("loadEarlierIssues")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── 通知 tab：事件流 + 类型筛选 + 行内偏好 ──
// 复用原 NotificationBell 的数据 hooks（30s 轮询、复合游标、标记已读、偏好）
function NotificationsTab() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const t = useTranslations("workbench");
  const tTypes = useTranslations("labels.notificationType");
  const tRel = useTranslations("ui.relative");
  const [filter, setFilter] = useState<(typeof NOTIF_FILTERS)[number]["key"]>("all");

  // 复合游标加载更早通知。older = 已加载的更早批次；
  // 10s 轮询/标记已读只重拉最新窗口，older 不丢
  const [older, setOlder] = useState<NotificationDTO[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const notifications = data?.notifications ?? [];
  const list = [...older, ...notifications];
  const filterType = NOTIF_FILTERS.find((f) => f.key === filter)?.type;
  const filtered = filterType ? list.filter((n) => n.type === filterType) : list;

  async function loadOlder() {
    const oldest = list[list.length - 1];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetchEarlierNotifications({
        before: new Date(oldest.createdAt).toISOString(),
        beforeId: oldest.id,
      });
      setOlder((prev) => [...prev, ...res.notifications]);
      setHasOlder(res.hasMore);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("loadEarlierNotificationsFailed"));
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div>
      {/* 工具行：类型筛选 chips + 操作 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="tablist" aria-label={t("notifFilterAria")}>
          {NOTIF_FILTERS.map((f) => {
            const count = f.type
              ? list.filter((n) => n.type === f.type).length
              : list.length;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs transition-colors",
                  filter === f.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`filters.${f.key}`)}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {/* 通知偏好：Popover 弹出框承载（验收定案；替代旧内联展开式） */}
          <Popover>
            <PopoverTrigger className="hover:text-foreground">{t("notifPreferences")}</PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-4">
              <PreferencesPanel />
            </PopoverContent>
          </Popover>
          {filtered.some((n) => !n.readAt) && (
            <button onClick={() => markRead.mutate(undefined)} className="hover:text-foreground">
              {t("markAllRead")}
            </button>
          )}
        </div>
      </div>

      {/* 通知偏好面板在顶部工具行的 Popover 中渲染 */}

      {data?.notifications.length === 0 && older.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          {t("notifEmpty")}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          {t("notifFilterEmpty")}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {filtered.map((n) => (
            <li key={n.id} className="border-b border-border/50 last:border-b-0">
              <Link
                href={n.url}
                onClick={() => markRead.mutate([n.id])}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/60",
                  !n.readAt && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    n.readAt ? "bg-transparent" : "bg-primary",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground/90">{n.title}</span>
                  {n.body && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {n.body}
                    </span>
                  )}
                </span>
                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground/60">
                  {typeLabel(tTypes, n.type)} · {fmtRelative(n.createdAt, tRel)}
                </span>
              </Link>
            </li>
          ))}
          {hasOlder && (
            <li className="border-t border-border/50">
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="w-full py-2.5 text-center text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {loadingOlder ? t("loadingInProgress") : t("loadEarlierNotifications")}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// 通知偏好（Popover 弹出框内容）：站内通知始终记录，此处仅控制企微推送
function PreferencesPanel() {
  const { data } = usePreferences();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const t = useTranslations("workbench");
  const tTypes = useTranslations("labels.notificationType");
  const prefs = data?.prefs ?? {};

  async function toggle(type: string, value: boolean) {
    setSaving(true);
    try {
      await apiPut("/api/notifications/preferences", {
        prefs: { ...prefs, [type]: { wecom: value } },
      });
      await qc.invalidateQueries({ queryKey: ["prefs"] });
    } catch (err) {
      // 偏好开关失败必须吵出来：静默等于用户以为已关掉企微推送
      toast.error(err instanceof Error ? err.message : t("prefsSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold">{t("notifPreferences")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("prefsHint")}
      </p>
      <ul className="mt-3 space-y-1">
        {Object.entries(prefs).map(([type, cfg]) => (
          <li key={type} className="flex items-center justify-between">
            <span className="text-sm text-foreground/90">{typeLabel(tTypes, type)}</span>
            <Switch
              checked={cfg.wecom}
              disabled={saving}
              onCheckedChange={(v) => toggle(type, v)}
            />
          </li>
        ))}
      </ul>
      {Object.keys(prefs).length === 0 && (
        <div className="mt-3 space-y-1" aria-label={t("prefsLoading")}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}

// 列表层自适应分组 + 工作区归属一级信号。
// 自适应结构：条目跨 ≥2 个工作区 → 按工作区分节（段头即“去往该工作区”的路标，可点击）；
//             单一工作区 → 保持混排（分组头只是噪音）。
// 恒定一级信号（任何形态成立）：归属面包屑“工作区 / 项目 / 编号”替换原二行灰字，
//             点击前的预期由此建立——“你将落到哪个工作区”在点击前可见。
function IssueTable({
  list,
  onOpen,
  onGoWorkspace,
}: {
  list: WBIssue[];
  onOpen: (i: WBIssue) => void;
  onGoWorkspace: (slug: string) => void;
}) {
  const t = useTranslations("workbench");
  const tRel = useTranslations("ui.relative");
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; slug: string; items: WBIssue[] }>();
    for (const i of list) {
      const key = i.project.workspace.slug;
      const g = map.get(key) ?? {
        name: i.project.workspace.name,
        slug: key,
        items: [],
      };
      g.items.push(i);
      map.set(key, g);
    }
    return [...map.values()];
  }, [list]);
  const sectioned = groups.length > 1;

  return (
    <div>
      {groups.map((g) => (
        <div key={g.slug} className={cn(sectioned ? "mb-4 last:mb-0" : "")}>
          {sectioned && (
            <button
              type="button"
              onClick={() => onGoWorkspace(g.slug)}
              title={t("goWorkspace", { name: g.name })}
              className="mb-1.5 flex items-center gap-2 px-1 text-left"
            >
              <Building2 className="size-3.5 text-muted-foreground/70" aria-hidden />
              <span className="text-sm font-medium text-foreground/90">{g.name}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {g.items.length}
              </span>
              <ChevronRight className="size-3 text-muted-foreground/40" aria-hidden />
            </button>
          )}
          <TableShell>
            <Table className="w-full text-sm">
              <TableHeader className="text-xs text-muted-foreground">
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="px-4 py-2.5 font-medium">{t("colIssue")}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t("colState")}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t("colAssignees")}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t("colUpdated")}</TableHead>
              </TableRow>
            </TableHeader>
              <TableBody>
                {g.items.map((i) => (
                  <TableRow
                    key={i.id}
                    onClick={() => onOpen(i)}
                    data-interactive
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <TableCell className="max-w-md px-4 py-2.5">
                      {/* 归属面包屑：一级信号（点击前可见落点） */}
                      <p className="mb-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-foreground/70">
                          {i.project.workspace.name}
                        </span>
                        <span className="text-muted-foreground/40">/</span>
                        {/* 项目名 chip：T2 需求——点击进入项目页；阻断行点击（问题详情）*/}
                        <Link
                          href={`/w/${i.project.workspace.slug}/p/${i.project.slug}`}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-md bg-muted/60 px-1.5 py-0.5 text-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {i.project.name}
                        </Link>
                        <span className="font-mono">#{i.number}</span>
                      </p>
                      <p className="truncate font-medium">{i.title}</p>
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <StateBadge state={i.state ? { name: i.state.name, color: i.state.color } : null} />
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <div className="flex -space-x-1.5">
                        {i.assignees.slice(0, 4).map((a) => (
                          <span key={a.user.id} title={a.user.name} className="ring-2 ring-background rounded-full">
                            <Avatar user={a.user} size={24} />
                          </span>
                        ))}
                        {i.assignees.length > 4 && (
                          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground ring-2 ring-background">
                            +{i.assignees.length - 4}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                      {fmtRelative(i.updatedAt, tRel)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        </div>
      ))}
    </div>
  );
}

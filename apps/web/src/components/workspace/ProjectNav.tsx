"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useProjects } from "@/lib/client/api";
import { fmtRelative } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import CreateProjectDialog from "@/components/workspace/CreateProjectDialog";
import { Archive, ChevronDown, Folder, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// U2.4：侧边栏项目列表硬化——mini 搜索（前端过滤）、归档项目折叠分组。
// 项目数 <8 时不渲染搜索框（免打扰）。

// U3.6：项目访问时间（localStorage per user）——「新动静」小圆点的事实源
function useLastVisits(userId: string) {
  const key = `project_visits:${userId}`;
  const [visits, setVisits] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setVisits(JSON.parse(localStorage.getItem(key) ?? "{}"));
    } catch {
      setVisits({});
    }
  }, [key]);
  function markVisited(id: string) {
    // 展示/落库同一份 next；写盘不进 setState updater（updater 须纯，StrictMode 会双调）
    const next = { ...visits, [id]: Date.now() };
    localStorage.setItem(key, JSON.stringify(next));
    setVisits(next);
  }
  return { visits, markVisited };
}

function ProjectLink({
  wsSlug,
  project,
  active,
  onNavigate,
  hasNews,
  collapsed,
}: {
  wsSlug: string;
  project: { id: string; slug: string; name: string; latestActivityAt?: string | null };
  active: boolean;
  onNavigate?: () => void;
  hasNews: boolean;
  collapsed?: boolean;
}) {
  const t = useTranslations("workspace");
  const tRel = useTranslations("ui.relative");
  const href = `/w/${wsSlug}/p/${project.slug}`;
  // 图标属性已按需求分析移除：统一用静态 Folder 图标，不再每项目可选图标
  const Icon = Folder;

  // 折叠态：只留图标，title 提示项目名，新动静圆点绝对定位右上
  if (collapsed) {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        title={hasNews ? t("projectTitleWithNews", { name: project.name }) : project.name}
        className={cn(
          "relative mx-auto mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-md",
          active ? "bg-primary/10 text-primary" : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {hasNews && (
          <span
            aria-label={t("hasNews")}
            title={t("latestActivity", { time: project.latestActivityAt ? fmtRelative(project.latestActivityAt, tRel) : "" })}
            className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
          />
        )}
      </Link>
    );
  }

  return (
    <span
      className={cn(
        "group/nav mb-0.5 flex items-center gap-1 rounded-md pr-1",
        active ? "bg-primary/10" : "hover:bg-accent",
      )}
    >
      <Link
        href={href}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pl-2 text-sm"
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-primary" : "text-muted-foreground/60",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "truncate",
            active ? "font-medium text-primary" : "text-foreground/70",
          )}
        >
          {project.name}
        </span>
        {/* U3.6：最新活动晚于上次访问 → 小圆点（进入项目即消） */}
        {hasNews && (
          <span
            aria-label={t("hasNews")}
            title={project.latestActivityAt ? t("latestActivity", { time: fmtRelative(project.latestActivityAt, tRel) }) : t("hasNews")}
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        )}
      </Link>
    </span>
  );
}

export default function ProjectNav({
  wsSlug,
  userId,
  canCreateProject,
  onNavigate,
  collapsed,
}: {
  wsSlug: string;
  userId: string;
  canCreateProject: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const t = useTranslations("workspace");
  const pathname = usePathname();
  const projects = useProjects(wsSlug);
  const { visits, markVisited } = useLastVisits(userId);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // 记录当前所在项目（进入即视为已读）
  useEffect(() => {
    const m = pathname?.match(/\/p\/([\w-]+)/);
    const seen = m && (projects.data ?? []).find((p) => p.slug === m[1]);
    if (seen) markVisited(seen.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, projects.data?.length]);

  const { active, archived } = useMemo(() => {
    const list = projects.data ?? [];
    const keyword = q.trim().toLowerCase();
    const match = (p: (typeof list)[number]) =>
      !keyword || p.name.toLowerCase().includes(keyword) || p.slug.includes(keyword);
    return {
      active: list.filter((p) => !p.isArchived && match(p)),
      archived: list.filter((p) => p.isArchived && match(p)),
    };
  }, [projects.data, q]);

  // 创建项目：共用 CreateProjectForm 单源（与工作区首页页面级入口同源），此处仅保留展开态

  const needsSearch = (projects.data?.length ?? 0) >= 8;

  // U3.6：未访问过或最新活动晚于上次访问 → 「新动静」小圆点
  const hasNews = (p: { id: string; latestActivityAt?: string | null }) => {
    if (!p.latestActivityAt) return false;
    const last = visits[p.id];
    if (typeof last !== "number") return false; // 从未访问过 → 首次访问前不亮，访问后才开始追踪（注意时间戳 0 合法）
    return new Date(p.latestActivityAt).getTime() > last;
  };

  return (
    <>
      {/* 折叠态：只留居中新建/项目图标列；搜索、归档分组都隐藏。
          新建项目改弹 Dialog（UI 验收定案）*/}
      {collapsed ? (
        <>
          {canCreateProject && (
            <div className="px-1.5 pt-1">
              <CreateProjectDialog wsSlug={wsSlug}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mx-auto flex size-8 text-muted-foreground/70"
                  title={t("newProjectOwnerOnly")}
                  aria-label={t("newProjectOwnerOnly")}
                >
                  <Plus className="size-4" />
                </Button>
              </CreateProjectDialog>
            </div>
          )}
          <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
            {projects.isLoading ? (
              <div className="space-y-1 py-2" aria-label={t("projectsLoading")}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="mx-auto size-8 rounded-md" />
                ))}
              </div>
            ) : (
              active.map((p) => (
                <ProjectLink
                  key={p.id}
                  wsSlug={wsSlug}
                  project={p}
                  active={!!pathname && (pathname === `/w/${wsSlug}/p/${p.slug}` || pathname.startsWith(`/w/${wsSlug}/p/${p.slug}/`))}
                  onNavigate={onNavigate}
                  hasNews={hasNews(p)}
                  collapsed
                />
              ))
            )}
          </nav>
        </>
      ) : (
      <>
      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
          {t("projectsLabel")}
        </span>
        {canCreateProject && (
          <CreateProjectDialog wsSlug={wsSlug}>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title={t("newProjectOwnerOnly")}
              aria-label={t("newProjectOwnerOnly")}
            >
              <Plus className="size-4" />
            </Button>
          </CreateProjectDialog>
        )}
      </div>

      {needsSearch && (
        <div className="px-3 pb-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("filterProjects")}
            className="h-7 text-xs"
            aria-label={t("filterProjectsAria")}
          />
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {projects.isLoading ? (
          <div className="space-y-1 px-2 py-2" aria-label={t("projectsLoading")}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : active.length || archived.length ? (
          <>
            {active.map((p) => (
              <ProjectLink
                key={p.id}
                wsSlug={wsSlug}
                project={p}
                active={!!pathname && (pathname === `/w/${wsSlug}/p/${p.slug}` || pathname.startsWith(`/w/${wsSlug}/p/${p.slug}/`))}
                onNavigate={onNavigate}
                hasNews={hasNews(p)}
              />
            ))}
            {archived.length > 0 && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground/80 hover:bg-accent"
                  aria-expanded={showArchived}
                  aria-label={t("archivedProjectsAria", { count: archived.length })}
                >
                  <Archive className="size-3" aria-hidden />
                  {t("archivedGroup", { count: archived.length })}
                  <ChevronDown
                    className={cn(
                      "ml-auto size-3 transition-transform",
                      showArchived && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {showArchived &&
                  archived.map((p) => (
                    <ProjectLink
                      key={p.id}
                      wsSlug={wsSlug}
                      project={p}
                      active={!!pathname && (pathname === `/w/${wsSlug}/p/${p.slug}` || pathname.startsWith(`/w/${wsSlug}/p/${p.slug}/`))}
                      onNavigate={onNavigate}
                      hasNews={hasNews(p)}
                    />
                  ))}
              </div>
            )}
          </>
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {q ? t("noMatchProjects") : t("noProjects")}
          </p>
        )}
      </nav>
      </>
      )}
    </>
  );
}

"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, TriangleAlert, RotateCcw, Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { StateBadge } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/client/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

// F2 全局搜索（顶栏常驻触发，⌘K）；跨工作区检索问题与项目（项目名命中 → 项目页深链）。
// 手写 fixed 遮罩已迁 shadcn Dialog（守 ui-guidelines「弹窗一律 Dialog」），
//       获得焦点陷阱/ESC/滚动锁/aria-modal；错误态可重试。
// 防抖只取消未发的定时器，取消不了在飞的请求——慢的旧响应回来会覆写新结果、
// 还把 loading 拉低，故 runSearch 以序号守卫：过期的响应整包丢弃。

type SearchProject = {
  id: string;
  name: string;
  slug: string;
  workspace: { slug: string };
  // API 直接给出目标地址（项目页）
  url: string;
};

type SearchIssue = {
  id: string;
  number: number;
  title: string;
  state: { name: string; color: string } | null;
  project: { name: string; slug: string; workspace: { slug: string } };
  // API 直接给出目标地址
  url: string;
};

type Results = { issues: SearchIssue[]; projects: SearchProject[] };

export default function GlobalSearch() {
  const router = useRouter();
  const t = useTranslations("search");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // ⌘K / Ctrl+K 全局触发
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 打开时聚焦（Dialog 自带焦点陷阱，这里保证输入框拿到焦点）；关闭时复位
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQ("");
      setResults(null);
      setFailed(null);
      setActive(0);
    }
  }, [open]);

  async function runSearch(query: string) {
    const seq = ++seqRef.current;
    setLoading(true);
    setFailed(null);
    try {
      const data = await apiGet<Results>(`/api/search?q=${encodeURIComponent(query)}`);
      if (seq !== seqRef.current) return; // 已有更新的搜索在飞，本响应作废
      setResults(data);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setResults(null);
      setFailed(e instanceof Error ? e.message : t("searchFailed"));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }

  // 防抖搜索
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const query = q.trim();
    if (!query) {
      seqRef.current++; // 作废在飞的旧查询
      setResults(null);
      setLoading(false);
      setFailed(null);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => void runSearch(query), 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q]);

  // 键盘导航的扁平序：项目组在前（宏观实体），问题组在后
  const flat: {
    key: string;
    kind: "project" | "issue";
    url: string;
    node: React.ReactNode;
  }[] = [];

  if (results) {
    for (const p of results.projects) {
      flat.push({
        key: `p-${p.id}`,
        kind: "project",
        url: p.url,
        node: (
          <>
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
              {p.workspace.slug}
            </span>
          </>
        ),
      });
    }
    for (const i of results.issues) {
      flat.push({
        key: `i-${i.id}`,
        kind: "issue",
        url: i.url,
        node: (
          <>
            <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">
              {i.project.slug.toUpperCase()}-{i.number}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{i.title}</span>
            <StateBadge state={i.state} />
          </>
        ),
      });
    }
  }

  function go(index: number) {
    const item = flat[index];
    if (!item) return;
    setOpen(false);
    router.push(item.url);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((v) => Math.min(v + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((v) => Math.max(v - 1, 0));
    } else if (e.key === "Enter") {
      go(active);
    }
  }

  return (
    <>
      {/* 顶栏 inline 形：常驻宽胶囊输入框（348×32、radius 12px、1px 边框、
          hover 边框加深、icon + placeholder + 右侧 kbd 提示），点击弹搜索 Dialog */}
      <button
        onClick={() => setOpen(true)}
        aria-label={t("openAria")}
        title={t("openTitle")}
        className="ml-auto flex h-8 w-[348px] items-center gap-2 rounded-xl border border-border bg-background pl-3 pr-2 text-left text-sm text-muted-foreground/80 transition-colors hover:border-foreground/40 hover:text-foreground max-sm:w-auto max-sm:shrink-0 max-sm:gap-0 max-sm:pl-2"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="hidden truncate sm:inline">{t("inlinePlaceholder")}</span>
        <kbd className="ml-auto hidden rounded-md border border-border bg-background px-1 py-0.5 font-mono text-xs text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* 搜索面板（Dialog 承载：焦点陷阱/ESC/滚动锁由 Radix 负责） */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[12vh] translate-y-0 gap-0 overflow-hidden rounded-xl p-0 sm:max-w-xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{t("dialogTitleSr")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("dialogDescSr")}
          </DialogDescription>

          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKey}
              placeholder={t("inputPlaceholder")}
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <div className="max-h-[52vh] overflow-y-auto p-1.5">
            {!q.trim() ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {t("emptyHint")}
              </p>
            ) : failed ? (
              <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                <TriangleAlert className="size-5 text-muted-foreground/50" aria-hidden />
                <p className="text-xs text-muted-foreground">{failed}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs text-muted-foreground"
                  onClick={() => void runSearch(q.trim())}
                >
                  <RotateCcw className="size-3" />
                  {tCommon("retry")}
                </Button>
              </div>
            ) : loading && !results ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("searching")}</p>
            ) : flat.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {loading ? t("retrieving") : t("noResults")}
              </p>
            ) : (
              <>
                {loading && (
                  <p className="flex items-center gap-1.5 px-2.5 pt-2 text-xs text-muted-foreground/70">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    {t("retrieving")}
                  </p>
                )}
                <div role="listbox" aria-label={t("dialogTitleSr")}>
                  {flat.map((item, idx) => (
                    <Fragment key={item.key}>
                      {/* 组标题随首条插行：项目组在前（宏观实体），问题组在后 */}
                      {item.kind === "project" && idx === 0 && (
                        <p className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                          {t("projectsGroup", { count: results!.projects.length })}
                        </p>
                      )}
                      {item.kind === "issue" && (idx === 0 || flat[idx - 1].kind === "project") && (
                        <p className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                          {t("issuesGroup", { count: results!.issues.length })}
                        </p>
                      )}
                      <div role="option" aria-selected={active === idx}>
                        <button
                          onClick={() => go(idx)}
                          onMouseEnter={() => setActive(idx)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left",
                            active === idx ? "bg-accent" : "hover:bg-accent/50",
                          )}
                        >
                          {item.node}
                        </button>
                      </div>
                    </Fragment>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground/70">
            <span>{t("kbdSelect")}</span>
            <span>{t("kbdOpen")}</span>
            <span>{t("kbdClose")}</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { UserOrigin } from "@prisma/client";
import { cn } from "@/lib/utils";
import TopBar from "@/components/shell/TopBar";

// 壳原语：四个壳（账号 / 工作区 / 设置 / 管理台）共享的骨架——
//   顶栏（TopBar，服务舱）+ 侧栏（identity / nav 插槽 + 底部展开收起）+ 移动 Sheet。
// 侧栏组织语法（三段结构）：① 本层身份（identity 插槽）② 本层词汇 + 下钻通道（nav 插槽）。
// 各壳差异仅集中在侧栏中部；scope 用于折叠态持久化键（各壳语境独立，不互相同步）。
// U2.5 沿袭：<md 转 Sheet 抽屉；桌面常驻、可收展开（localStorage 持久化）。
// 高度约定：顶栏 h-12（3rem）占视口顶部，侧栏高 = 100dvh − 3rem（钉视口、内容内部滚）。

type ShellSlot = (col: boolean, onNavigate?: () => void) => React.ReactNode;

// 侧栏内容必须声明在模块层：函数体内声明组件 = 每次渲染产生新组件类型，
// React 会把整棵子树卸载重挂（内部状态、滚动位置、DOM 全丢）。
// col === undefined 表示移动抽屉语境（无折叠概念，底部行不渲染）。
function SidebarContent({
  identity,
  nav,
  col,
  onNavigate,
  onToggle,
}: {
  identity?: ShellSlot;
  nav: ShellSlot;
  col?: boolean;
  onNavigate?: () => void;
  onToggle: () => void;
}) {
  const t = useTranslations("shell");
  return (
    <div className={cn("flex h-full min-h-0 flex-col", col && "items-stretch")}>
      {/* ① 本层身份（插槽缺省时不渲染容器——避免空块占位） */}
      {identity && (
        <div className={cn("border-b border-border bg-card py-3.5", col ? "px-2.5" : "px-4")}>
          {identity(!!col, onNavigate)}
        </div>
      )}

      {/* ② 本层词汇 + 下钻通道（各壳内容自管内部滚动） */}
      <div className="flex min-h-0 flex-1 flex-col">
        {nav(!!col, onNavigate)}
      </div>

      {/* 底部：仅展开/收起（账号与服务已上移顶栏；移动抽屉无折叠概念，不渲染） */}
      {col !== undefined && (
        <div className="border-t border-border bg-card py-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 w-full gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground",
              col && "h-8 px-0",
            )}
            aria-label={col ? t("expandSidebar") : t("collapseSidebar")}
            title={col ? t("expandSidebar") : t("collapseSidebar")}
            onClick={onToggle}
          >
            {col ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <>
                <PanelLeftClose className="size-3.5" />
                <span>{t("collapseSidebar")}</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ShellScaffold({
  user,
  identity, // 本层身份块（侧栏顶部；可缺省，账号壳已移除纯展示锚点）
  nav, // 本层词汇 + 下钻通道
  // 折叠键分域：业务壳不传 scope→键 sidebar_collapsed；治理/偏好/账号壳传
  // "admin"/"settings"/"account" → <scope>_sidebar_collapsed（docs/07 §7）
  scope,
  children,
}: {
  user: { name: string; email?: string | null; origin?: UserOrigin | null; isAdmin?: boolean };
  identity?: ShellSlot;
  nav: ShellSlot;
  scope?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 折叠持久化键：无 scope（业务壳）= sidebar_collapsed；其余壳 = <scope>_sidebar_collapsed
  const storeKey = scope ? `${scope}_sidebar_collapsed` : "sidebar_collapsed";

  // 桌面侧边栏收起/展开（localStorage 持久化；键含 scope——各壳语境独立）
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(storeKey) === "1");
  }, [storeKey]);
  function toggleCollapsed() {
    // 写盘不进 updater（updater 须纯；StrictMode 双调会写两遍）
    const next = !collapsed;
    localStorage.setItem(storeKey, next ? "1" : "0");
    setCollapsed(next);
  }

  // 路由变化自动收抽屉（移动端点导航项后不残留遮罩）
  const routeKey = pathname ?? "";
  const [lastRoute, setLastRoute] = useState(routeKey);
  if (routeKey !== lastRoute) {
    setLastRoute(routeKey);
    if (drawerOpen) setDrawerOpen(false);
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <TopBar
        user={user}
        leading={
          <div className="md:hidden">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={t("openNavigation")}>
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 [&>button]:hidden">
                <SheetTitle className="sr-only">{t("navigation")}</SheetTitle>
                <SidebarContent
                  identity={identity}
                  nav={nav}
                  onNavigate={() => setDrawerOpen(false)}
                  onToggle={toggleCollapsed}
                />
              </SheetContent>
            </Sheet>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* 桌面侧边栏：占满顶栏以下视口高（外层 h-dvh overflow-hidden，
            主体在自己容器内滚动），内容内部滚；收起态 52px 图标列 */}
        <aside
          className={cn(
            "hidden shrink-0 border-r border-border bg-card md:flex md:flex-col",
            collapsed ? "w-[52px]" : "w-60",
          )}
        >
          <SidebarContent
            identity={identity}
            nav={nav}
            col={collapsed}
            onToggle={toggleCollapsed}
          />
        </aside>

        {/* main 加 relative：radix/shadcn Select 内置的 sr-only 原生 select 是
	    position:absolute，若到 body 之间无 positioned 祖先，包含块会逃逸到
	    body，撑高文档产生 window+main 双滚动条；relative+overflow 裁剪归位。
	    高度约定不变：侧栏钉视口，主体在自己容器内滚 */}
        <main className="relative min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// 静态分区导航单源：从 AdminShell / SettingsShell 逐行相同的 nav 插槽抽出。
// 只覆盖「数组驱动」的静态分区导航；动态树（workspace 的 ProjectNav 下钻）不在此列。
// 分区单源约定不变：新增分区 = 壳的 NAV 数组加一行 + 建路由文件夹。
// exact：默认前缀匹配（pathname.startsWith）；短路径可能被兄弟路径前缀误吞时置 true。

type StaticNavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

export function StaticNav({
  items,
  collapsed,
  onNavigate,
}: {
  items: readonly StaticNavItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("gap-0.5 pt-2 flex flex-col", collapsed ? "px-1.5" : "px-2")}>
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={item.label}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center rounded-md text-sm text-foreground/80 hover:bg-accent",
              collapsed ? "justify-center p-2" : "gap-2 px-2.5 py-2 font-medium",
              active && "bg-primary/10 text-primary",
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

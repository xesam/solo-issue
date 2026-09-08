"use client";

import { cn } from "@/lib/utils";

// 侧栏身份块单源（ShellScaffold ① identity 插槽的标准实现）：
// 图标 + 标题 + 副文案，折态收成图标位。AdminShell / SettingsShell 逐行同构抽出。

export function ShellIdentity({
  icon: Icon,
  title,
  subtitle,
  collapsed,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  collapsed: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      {!collapsed && (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      )}
    </div>
  );
}

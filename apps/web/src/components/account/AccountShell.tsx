"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { useWorkspaces } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import ShellScaffold from "@/components/shell/ShellScaffold";

// 账号壳：/me 层的容器。侧栏两段结构——
// ① identity 插槽传空保留骨架签名（台上身份由顶栏账号菜单承担，②' 决策）；
// ② 本层词汇：工作台（/me 本页项）+「工作区」独立分组段 = 下钻通道
//    （joinedAt 序、内部滚动、跳级禁令：工作区行不透出项目内容）。

export default function AccountShell({
  user,
  children,
}: {
  user: { name: string; email?: string | null; origin?: import("@prisma/client").UserOrigin | null; isAdmin?: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations("account");
  const { data: workspaces } = useWorkspaces();
  const meActive = (pathname ?? "").startsWith("/me");

  return (
    <ShellScaffold
      user={user}
      scope="account"
      nav={(col) => (
        <>
          <nav className={cn("pb-1 pt-1", col ? "px-1.5" : "px-2")}>
            <Link
              href="/me"
              title={t("workbench")}
              aria-label={t("workbench")}
              className={cn(
                "flex items-center rounded-md text-sm text-foreground/80 hover:bg-accent",
                col ? "justify-center p-2" : "gap-2 px-2.5 py-2 font-medium",
                meActive && "bg-primary/10 text-primary",
              )}
            >
              <Building2 className="size-4 shrink-0" aria-hidden />
              {!col && <span>{t("workbench")}</span>}
            </Link>
          </nav>

          {/* 下钻通道：工作区分组段（joinedAt 序——useWorkspaces 保持 API 原序） */}
          <div className={cn("min-h-0 flex-1 overflow-y-auto", col ? "pt-1" : "pt-3")}>
            {!col && workspaces != null && workspaces.length > 0 && (
              <p className="px-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                {t("workspaces")}
              </p>
            )}
            <nav className={cn(col ? "px-1.5" : "px-2")}>
              {workspaces != null && workspaces.length === 0 && !col && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  {t("noWorkspaces")}
                </p>
              )}
              {workspaces?.map((w) => (
                <div
                  key={w.id}
                  className={cn(
                    "mb-0.5 flex items-center rounded-md text-sm",
                    col
                      ? "justify-center p-0 text-muted-foreground/70"
                      : "pr-1 text-foreground/70 hover:bg-accent",
                  )}
                >
                  {/* 主行：下钻进入工作区层（本层职责，不可缺失） */}
                  <Link
                    href={`/w/${w.slug}`}
                    title={w.name}
                    className={cn(
                      "flex min-w-0 flex-1 items-center rounded-md",
                      col ? "justify-center p-2" : "gap-2 px-2.5 py-1.5",
                      "hover:text-foreground",
                    )}
                  >
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                    {!col && <span className="truncate">{w.name}</span>}
                  </Link>
                  {/* 行尾副动作：该工作区的任务汇总（/me?ws=收窄态，验收点 2） */}
                  {!col && (
                    <Link
                      href={`/me?ws=${w.slug}`}
                      title={t("wsTaskSummary", { name: w.name })}
                      aria-label={t("wsTaskSummary", { name: w.name })}
                      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Inbox className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
              ))}
            </nav>
          </div>
        </>
      )}
    >
      {children}
    </ShellScaffold>
  );
}

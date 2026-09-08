"use client";

import { useRouter } from "next/navigation";
import { useWorkspaces } from "@/lib/client/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// U2.1：工作区切换器。多工作区 → 下拉切换；单工作区 → 只读展示（不装下拉交互成本）。
// 切换固定落到目标工作区首页——项目/issue 在工作区间不存在对应关系，保留子路径只会 404。
export default function WorkspaceSwitcher({
  currentSlug,
  currentName,
  collapsed,
}: {
  currentSlug: string;
  currentName: string;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("workspace");
  const { data } = useWorkspaces();
  const many = (data?.length ?? 0) > 1;

  // 折叠态：只留图标（多工作区时仍可下拉切换，title 提示当前名）
  if (collapsed) {
    if (!many) {
      return (
        <div className="flex justify-center" title={t("currentWorkspaceTitle", { name: currentName })}>
          <Building2 className="size-4 text-muted-foreground/70" aria-hidden />
        </div>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="mx-auto flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("switchWorkspaceAria", { name: currentName })}
          title={t("switchWorkspaceAria", { name: currentName })}
        >
          <Building2 className="size-4 text-muted-foreground/70" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-56">
          <DropdownMenuLabel>{t("myWorkspaces")}</DropdownMenuLabel>
          {data?.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onClick={() => router.push(`/w/${w.slug}`)}
              className={cn(w.slug === currentSlug && "font-medium text-primary")}
            >
              <Check
                className={cn("size-3.5", w.slug !== currentSlug && "opacity-0")}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="text-xs text-muted-foreground">{t("projectCount", { count: w.projectCount })}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (!many) {
    return (
      <div className="flex items-center gap-2">
        <Building2 className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            {t("workspaceLabel")}
          </p>
          <p className="truncate text-sm font-semibold">{currentName}</p>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("switchWorkspaceAria", { name: currentName })}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            {t("workspaceLabel")}
          </p>
          <p className="truncate text-sm font-semibold">{currentName}</p>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-56">
        <DropdownMenuLabel>{t("myWorkspaces")}</DropdownMenuLabel>
        {data?.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => router.push(`/w/${w.slug}`)}
            className={cn(w.slug === currentSlug && "font-medium text-primary")}
          >
            <Check
              className={cn("size-3.5", w.slug !== currentSlug && "opacity-0")}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            <span className="text-xs text-muted-foreground">{t("projectCount", { count: w.projectCount })}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

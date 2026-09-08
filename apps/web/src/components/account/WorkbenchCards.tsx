"use client";

import Link from "next/link";
import { ListTodo, PenLine, Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAccountBadges } from "@/components/shell/TopBar";

// 账号壳首页的计数卡阵列（GitLab 语法：计数即导航——点击直达对应视图）。
// 数据与顶栏徽标舱同源（useAccountBadges，共享缓存与 30s 轮询）。

const CARDS = [
  {
    key: "assigned",
    labelKey: "assignedLabel",
    descKey: "assignedDesc",
    icon: ListTodo,
    href: "/me?tab=assigned",
  },
  {
    key: "created",
    labelKey: "createdLabel",
    descKey: "createdDesc",
    icon: PenLine,
    href: "/me?tab=created",
  },
  {
    key: "unread",
    labelKey: "unreadLabel",
    descKey: "unreadDesc",
    icon: Bell,
    href: "/me?tab=notifications",
  },
] as const;

export default function WorkbenchCards() {
  const badges = useAccountBadges();
  const t = useTranslations("account");
  const counts = {
    assigned: badges.assigned,
    created: badges.created,
    unread: badges.unread,
  } as Record<(typeof CARDS)[number]["key"], number | undefined>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {CARDS.map((c) => {
        const label = t(c.labelKey);
        return (
          <Link
            key={c.key}
            href={c.href}
            title={t("goCard", { name: label })}
            aria-label={t("goCard", { name: label })}
            className="rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              <c.icon className="size-3.5" aria-hidden />
              {label}
            </div>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">
              {counts[c.key] === undefined ? "–" : counts[c.key]}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t(c.descKey)}</p>
          </Link>
        );
      })}
    </div>
  );
}

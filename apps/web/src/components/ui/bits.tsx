"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { UserLite } from "@/lib/dto";
import { LOCALE_COOKIE, type Locale, type Translator } from "@/i18n/config";
import enMessages from "@/messages/en.json";
import zhMessages from "@/messages/zh.json";

// 领域 UI 件：状态点 / 头像 / 日期格式化
// 状态色是「领域语义数据」（跨主题固定），不走主题令牌；
// 外观层（容器/文字/边框）使用语义令牌 —— 见 docs/07-ui-guidelines.md

export function StateBadge({
  state,
}: {
  state: { name: string; color: string } | null;
}) {
  const t = useTranslations("ui");
  if (!state)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {t("noState")}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground/70">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: state.color }}
      />
      {state.name}
    </span>
  );
}

// Avatar 只消费 name（头像兜底 initials）；入参放结构类型而非 UserLite，
// 调用点可用任意画像子集构造（Unknown origin 等不参与展示）
type AvatarUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  origin?: unknown;
};

export function Avatar({ user, size = 24 }: { user: AvatarUser | null; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      title={user?.name ?? ""}
    >
      {(user?.name ?? "?").slice(0, 1)}
    </span>
  );
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD */
const UI_RELATIVE: Record<Locale, Record<string, string>> = {
  en: enMessages.ui.relative,
  zh: zhMessages.ui.relative,
};

// 无 t 调用方的默认语言探测（next-intl 请求协商的客户端镜像）：
// cookie（切换器写入，一年期）→ 浏览器语言 → SSR 无窗口时按中文（改造前行为）
function detectUiLocale(): Locale {
  if (typeof document !== "undefined") {
    const m = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=(en|zh)(?:;|$)`),
    );
    if (m) return m[1] === "zh" ? "zh" : "en";
    return (navigator.language ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  return "zh";
}

// 兜底翻译器（ui.relative 子命名空间；结构与 next-intl 的 t 对齐，插值同 {name} 单花括号约定）
function relativeFallback(): Translator {
  const table = UI_RELATIVE[detectUiLocale()];
  return (key, params) => {
    const template = table[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (m, name: string) =>
      name in params ? String(params[name]) : m,
    );
  };
}

export function fmtRelative(d: Date | string | null | undefined, t?: Translator) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60_000);
  const tr = t ?? relativeFallback();
  if (min < 1) return tr("justNow");
  if (min < 60) return tr("minutesAgo", { count: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return tr("hoursAgo", { count: hour });
  const day = Math.floor(hour / 24);
  if (day === 1) return tr("yesterday");
  if (day < 30) return tr("daysAgo", { count: day });
  return fmtDate(date);
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fmtDate(date)} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

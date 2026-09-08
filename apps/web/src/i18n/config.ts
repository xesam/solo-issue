// i18n 基础常量与协商逻辑（无路由前缀模式：cookie → Accept-Language → 英文兜底）。
// 唯一事实源：src/messages/{en,zh}.json；本文件不含文案。

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// 语言偏好 cookie（切换器写入；Agent/curl 不带它时享受兜底英文）
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

// Accept-Language 协商：按序扫描（浏览器已按偏好排序），取首个主子标签匹配项；
// 匹配不上（ja/fr/…）一律落英文兜底
export function matchAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

// 最小翻译函数形状：next-intl 的 t（useTranslations）与服务端 translatorFor 均结构兼容。
// 客户端模块（label 单源等）只 import 本类型，绝不 import server.ts（其携带 next/headers）
export type Translator = (key: string, params?: Params) => string;

// 插值参数值域
export type Params = Record<string, string | number>;


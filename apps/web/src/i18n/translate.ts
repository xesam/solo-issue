// 纯翻译函数链（无 next/headers 依赖，单测可直测，见 tests/unit/i18n.test.ts）。
// server.ts 在此之上叠请求作用域的 locale 解析并原样转出 translatorFor。

import {
  DEFAULT_LOCALE,
  type Locale,
  type Params,
  type Translator,
} from "@/i18n/config";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

const MESSAGES: Record<Locale, unknown> = { en, zh };

// 点路径取值（"errors.issueNotFound" → messages.errors.issueNotFound）。
// 未命中返回 undefined 由调用方决定兜底策略（回 key 本身——漏翻译可见）
function lookup(locale: Locale, key: string): string | undefined {
  let node: unknown = MESSAGES[locale];
  for (const seg of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === "string" ? node : undefined;
}

// {name} 插值（与 next-intl 的 ICU 基础语法保持一致，消息文件可互通）
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

// 指定 locale 的纯翻译函数（worker / handle / fail 边界共用）。
// zh 未命中回退 en（en 为事实源），en 未命中回 key 本身——漏翻译可被肉眼立刻发现
export function translatorFor(locale: Locale): Translator {
  return (key, params) => {
    const raw = lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key);
    const template = raw === undefined ? key : raw;
    return interpolate(template, params);
  };
}

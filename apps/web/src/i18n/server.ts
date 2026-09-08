// 服务端 i18n 工具：请求内 locale 解析 + 纯函数翻译器。
// 两个消费面：
// - HTTP 上下文（RSC / server action / route handler）：resolveRequestLocale() 读 cookie+头
// - Worker（pg-boss 消费，无请求上下文）：入队时把 locale 快照进 job payload，
//   消费侧用 translatorFor(locale) 渲染——与 next-intl 共用同一份 messages JSON

import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  matchAcceptLanguage,
  type Locale,
  type Params,
  type Translator,
} from "@/i18n/config";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

const MESSAGES: Record<Locale, unknown> = { en, zh };

// 请求内解析：cookie > Accept-Language > 英文兜底。
// 仅在请求作用域可调（NextRequest/renderer）；worker/脚本层禁用，改走快照 + translatorFor
export async function resolveRequestLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (cookieLocale === "en" || cookieLocale === "zh") return cookieLocale;
  return matchAcceptLanguage((await headers()).get("accept-language"));
}

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

// 请求内翻译函数兜底（错误出口等不便层层传 t 的场景）；
// 等价 translatorFor(await resolveRequestLocale())
export async function requestTranslator(): Promise<Translator> {
  return translatorFor(await resolveRequestLocale());
}

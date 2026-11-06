// 服务端 i18n 工具：请求内 locale 解析 + 纯函数翻译器。
// 两个消费面：
// - HTTP 上下文（RSC / server action / route handler）：resolveRequestLocale() 读 cookie+头
// - Worker（pg-boss 消费，无请求上下文）：入队时把 locale 快照进 job payload，
//   消费侧用 translatorFor(locale) 渲染——与 next-intl 共用同一份 messages JSON

import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE,
  matchAcceptLanguage,
  type Locale,
  type Translator,
} from "@/i18n/config";
import { translatorFor } from "@/i18n/translate";

// 纯函数链拆至 translate.ts（无 next/headers 依赖，单测可直测）；
// 此处原样转出，消费方（notification / im-send / wecom real 等）的既有 import 路径不变
export { translatorFor };

// 请求内解析：cookie > Accept-Language > 英文兜底。
// 仅在请求作用域可调（NextRequest/renderer）；worker/脚本层禁用，改走快照 + translatorFor
export async function resolveRequestLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (cookieLocale === "en" || cookieLocale === "zh") return cookieLocale;
  return matchAcceptLanguage((await headers()).get("accept-language"));
}

// 请求内翻译函数兜底（错误出口等不便层层传 t 的场景）；
// 等价 translatorFor(await resolveRequestLocale())
export async function requestTranslator(): Promise<Translator> {
  return translatorFor(await resolveRequestLocale());
}

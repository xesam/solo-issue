import { getRequestConfig } from "next-intl/server";
import { resolveRequestLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/config";

// next-intl 请求配置（无路由前缀模式）：locale 来自 cookie/Accept-Language 协商，
// 与 src/i18n/server.ts 共用同一协商链，服务端 next-intl API 与自研Translator 永不漂移

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  const safeLocale = isLocale(locale) ? locale : "en";
  return {
    locale: safeLocale,
    messages: (await import(`@/messages/${safeLocale}.json`)).default,
  };
});

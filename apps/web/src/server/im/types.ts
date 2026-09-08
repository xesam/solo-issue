// IM 集成抽象：登录（IdentityProvider）与通知（NotificationChannel）
// 新增渠道（钉钉/飞书）= 实现这两个接口 + 注册，核心流程与 schema 零改动

import type { Locale } from "@/i18n/config";

export type ImProviderMode = "real" | "mock";

/**
 * 登录流程类型（对齐企微双体系，未来渠道同构表达）：
 * - in-app：企微客户端内 WebView 静默授权（snsapi_base）
 * - web：系统浏览器（PC）Web 登录（wwlogin 扫码/快速登录）
 */
export type ImLoginFlow = "in-app" | "web";

export interface ImIdentityResult {
  providerUserId: string; // 企微 userid；mock 通道落库的 Identity 键一律 "mock:new:<name>"（"mock:<userId>" 仅是登录链路的授权码形态）
  name?: string;
  email?: string | null;
  avatarUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ImIdentityProvider {
  id: "WECOM";
  mode: ImProviderMode;
  /** provider 声明支持的登录流程（providers API 原样下发，登录页按环境匹配入口） */
  supportedFlows: readonly ImLoginFlow[];
  buildAuthUrl(
    flow: ImLoginFlow,
    params: {
      state: string;
      redirectUri: string;
      userAgent?: string;
    },
  ): Promise<string>;
  exchangeCode(flow: ImLoginFlow, code: string): Promise<ImIdentityResult>;
}

export interface ImMessage {
  title: string; // "[XX项目] PROJ-12 已指派给你"
  summary: string; // 纯文本摘要
  url: string; // 深链
}

export interface ImNotificationChannel {
  id: "WECOM";
  mode: ImProviderMode;
  /** providerUserId = 企微 userid（real）/ "mock:new:<name>"（mock 通道的 Identity 键） */
  sendToUser(
    providerUserId: string,
    message: ImMessage,
    locale?: Locale,
  ): Promise<void>;
}

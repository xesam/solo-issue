import type { ImIdentityProvider, ImNotificationChannel } from "../types";
import { getWecomConfig, type WecomConfig } from "./config";
import { WecomMockChannel, WecomMockProvider } from "./mock";
import { WecomRealChannel, WecomRealProvider } from "./real";

// Provider 注册表：按配置解析实现（mock / real）
// 凭证从 env 或 ProviderCredential 表出现时，自动切换为真实适配器

export async function getWecomProvider(): Promise<ImIdentityProvider | null> {
  const cfg = await getWecomConfig();
  if (!cfg) return null;
  // real 登录链路必须复用 cachedReal 的同一 provider 实例：
  // 企微重复 gettoken 会互踢旧 token，登录侧新建实例会让推送缓存里的 token
  // 在几分钟内失效（7200s 缓存直到自然过期前每次推送都 40014）
  if (cfg.mode === "mock") return new WecomMockProvider();
  return getSharedRealProvider(cfg);
}

// real 通道持有 access_token 缓存（real.ts：7200s + 并发收敛，企微重复 gettoken 会
// 互踢旧 token）——必须按 config 复用同一 provider 实例，否则每条通知都重新取 token
// （getWecomConfig 每次都新建对象，按内容判等）
let cachedReal: { key: string; provider: WecomRealProvider } | null = null;

function getSharedRealProvider(cfg: WecomConfig): WecomRealProvider {
  const key = `${cfg.corpId}|${cfg.agentId}|${cfg.secret}`;
  if (!cachedReal || cachedReal.key !== key)
    cachedReal = { key, provider: new WecomRealProvider(cfg) };
  return cachedReal.provider;
}

export async function getWecomChannel(): Promise<ImNotificationChannel | null> {
  const cfg = await getWecomConfig();
  if (!cfg) return null;
  if (cfg.mode === "mock") return new WecomMockChannel();
  return new WecomRealChannel(getSharedRealProvider(cfg), { agentId: cfg.agentId });
}

import type { ImMessage } from "@/server/im/types";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { translatorFor } from "@/i18n/server";
import { resolvePrefs } from "./notification";
import { getWecomChannel } from "@/server/im/wecom";

// worker 消费：按偏好过滤 → 身份解析 → IM 推送
// 至少一次语义（pg-boss 重试可能造成少量重复推送，IM 场景可接受）
// locale 为入队时快照：dispatchIm 把触发动作的用户 locale 写进 payload；
// 旧 payload 无 locale 字段时兜底英文（worker 兼容）

export async function processImSend(payload: { notificationIds: string[]; locale?: string }) {
  const channel = await getWecomChannel();
  if (!channel) {
    console.warn("[im-send] IM 通道未配置，跳过", payload.notificationIds.length, "条");
    return;
  }

  const notifications = await prisma.notification.findMany({
    where: { id: { in: payload.notificationIds } },
  });
  if (!notifications.length) return;

  // 批内预取：身份/偏好都不足以在循环外证实，逐条查询会对同批同用户重复打 DB
  const userIds = [...new Set(notifications.map((n) => n.userId))];
  // 身份：该用户需有企微身份（如管理员直接建号的用户则跳过）；
  // user.isActive 在此复核——emit 与消费之间用户可能刚被停用
  const identityByUser = new Map(
    (await prisma.identity.findMany({
      where: { provider: "WECOM", userId: { in: userIds }, user: { isActive: true } },
    })).map((i) => [i.userId, i]),
  );

  // 偏好按 (userId, projectId) 批内去重（resolvePrefs 对全部类型填满，不缺 key）
  const prefsCache = new Map<string, Awaited<ReturnType<typeof resolvePrefs>>>();
  // 摘要兜底文案按入队时刻的 locale 渲染
  const locale = payload.locale === "zh" ? "zh" : "en";
  const t = translatorFor(locale);

  for (const n of notifications) {
    const prefsKey = `${n.userId}|${n.projectId}`;
    const prefs = prefsCache.get(prefsKey) ?? (await resolvePrefs(n.userId, n.projectId));
    prefsCache.set(prefsKey, prefs);
    if (prefs[n.type].wecom === false) continue;

    const identity = identityByUser.get(n.userId);
    if (!identity) continue;

    const message: ImMessage = {
      title: n.title,
      summary: n.body || t("im.viewDetails"),
      url: `${env().APP_URL}${n.url}`,
    };

    try {
      await channel.sendToUser(identity.providerUserId, message, locale);
    } catch (e) {
      console.error(`[im-send] 推送失败 notif=${n.id} to=${identity.providerUserId}:`, e);
      throw e; // 整个 job 重试（重试可能重复推送已成功项，可接受）
    }
  }
}

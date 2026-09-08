"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/client/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmDialog from "@/components/ui/confirm-dialog";

// 账号分区内的其他设备管理（原「安全」页 LoginDevicesPanel 降维而来）。
// 安全页已裁撤：明细会话列表砍掉，保留唯一核心操作「登出其他设备」
// （修改密码本身也会吊销其他会话，但用户不想改密、只想踢掉公用电脑时这是唯一入口）。
export default function OtherDevicesRow() {
  const qc = useQueryClient();
  const t = useTranslations("settings");
  const [revoking, setRevoking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const sessions = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => apiGet<{ id: string; current: boolean }[]>("/api/auth/sessions"),
  });

  const others = (sessions.data ?? []).filter((s) => !s.current).length;
  const busy = revoking || sessions.isLoading;

  async function revokeAll() {
    if (revoking) return; // ConfirmDialog 不自关：确认即刻收弹层，防飞行中二次确认重入
    setConfirming(false);
    setRevoking(true);
    try {
      const res = await apiPost<{ revoked: number }>("/api/auth/sessions/revoke-all", {});
      toast.success(t("signedOutOthersToast", { count: res.revoked }));
      await qc.invalidateQueries({ queryKey: ["my-sessions"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("operationFailed"));
    } finally {
      setRevoking(false);
    }
  }

  // 状态文案如实分段：加载/失败不能伪装成「仅当前设备在线」（那是最危险的误导）
  const statusText = sessions.isLoading
    ? t("devicesLoading")
    : sessions.isError
      ? t("devicesError")
      : others
        ? t("devicesOthers", { count: others })
        : t("devicesOnlyCurrent");

  // 头部条卡片：标题+状态在左，主操作在右（与项目设置卡片同构）
  return (
    <div className="flex items-center justify-between rounded-t-xl bg-muted/50 px-4 py-3">
      <div>
        <p className="text-sm font-medium">{t("otherDevices")}</p>
        <p className="text-xs text-muted-foreground">
          {sessions.isLoading ? <Skeleton className="h-3 w-28" /> : statusText}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || sessions.isError || !others}
        onClick={() => setConfirming(true)}
      >
        {revoking ? t("signingOut") : t("signOutOthers")}
      </Button>
      {/* 一次性踢掉全部其他会话属不可逆操作：走 ConfirmDialog（与撤销 API 令牌同档） */}
      <ConfirmDialog
        open={confirming}
        title={t("signOutOthers")}
        description={t("signOutOthersDesc", { count: others })}
        confirmLabel={t("signOut")}
        destructive
        onConfirm={revokeAll}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

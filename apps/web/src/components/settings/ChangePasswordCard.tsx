"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPut } from "@/lib/client/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";

// 账号分区内的修改密码卡片（原「安全」分区内联表单迁入，逻辑不变）。
// 修改密码成功后服务端自动吊销其他会话，当前会话保留。
export default function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
    if (currentPassword === newPassword) {
      setError(t("sameAsCurrent"));
      return;
    }
    setLoading(true);
    try {
      await apiPut("/api/auth/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      toast.success(t("passwordUpdatedToast"));
      // 副路径吊销也要刷新同页的会话计数，否则「其他设备 N 台在线」继续虚高
      await qc.invalidateQueries({ queryKey: ["my-sessions"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("changeFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid max-w-sm gap-3">
        <div className="space-y-1">
          <Label htmlFor="acct-current" className="text-xs">{t("currentPassword")}</Label>
          <Input
            id="acct-current"
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acct-new" className="text-xs">{t("newPasswordHint")}</Label>
          <Input
            id="acct-new"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="acct-confirm" className="text-xs">{t("confirmNewPassword")}</Label>
          <Input
            id="acct-confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="py-2">
          <TriangleAlert className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="sm" disabled={loading}>
        {loading ? tCommon("saving") : t("updatePassword")}
      </Button>
    </form>
  );
}

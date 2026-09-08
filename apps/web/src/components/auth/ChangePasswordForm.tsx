"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiPut } from "@/lib/client/api";
import { withBase } from "@/lib/base-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";

// 改密页：首登强制（forced）与自助修改共用

export default function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      window.location.href = withBase("/"); // 全量刷新以重载会话态
    } catch (err) {
      setError(err instanceof Error ? err.message : t("changeFailed"));
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {forced ? t("forcedTitle") : t("changePassword")}
          </h1>
          {forced && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("forcedHint")}
            </p>
          )}
        </div>

        <Card className="shadow-sm">
          <CardContent className="p-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="current">{t("currentPassword")}{forced && t("currentPasswordInitial")}</Label>
                <Input
                  id="current"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new">{t("newPasswordHint")}</Label>
                <Input
                  id="new"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm">{t("confirmNewPassword")}</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              {error && (
                <Alert variant="destructive" className="py-2">
                  <TriangleAlert className="size-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? tCommon("saving") : t("saveAndContinue")}
              </Button>
            </form>
          </CardContent>
        </Card>

        {!forced && (
          <button
            className="mt-4 w-full text-center text-xs text-muted-foreground/60 hover:text-foreground"
            onClick={() => router.back()}
          >
            {t("back")}
          </button>
        )}
      </div>
    </main>
  );
}

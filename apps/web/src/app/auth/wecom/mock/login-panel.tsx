"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/client/api";
import { withBase } from "@/lib/base-path";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";

type MockUser = { id: string; name: string };

// 模拟「企微授权页」——仅 mock 通道服务（page.tsx 服务端按 provider.mode 404 守卫）
export default function MockLoginPanel() {
  const sp = useSearchParams();
  const t = useTranslations("mock");
  const tCommon = useTranslations("common");
  const state = sp.get("state") ?? "";
  const [users, setUsers] = useState<MockUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  async function load() {
    try {
      setUsers(await apiGet<MockUser[]>("/api/auth/mock/users"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    }
  }
  useEffect(() => {
    load();
  }, []);

  function login(userId: string) {
    if (!state) {
      setError(t("missingState"));
      return;
    }
    setBusy(true);
    window.location.href = withBase(`/api/auth/wecom/callback?code=mock:${encodeURIComponent(userId)}&state=${state}`);
  }

  // 模拟"企微通讯录存在、系统未登录过"的新同事：不预建账号，
  // 构造 mock:new:<name> code 直接走真实首登建号链路（origin=WECOM、无 email）
  function createAndLogin(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!state) {
      setError(t("missingState"));
      return;
    }
    if (!name) return;
    setBusy(true);
    window.location.href = withBase(
      `/api/auth/wecom/callback?code=mock:new:${encodeURIComponent(name)}&state=${state}`,
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md shadow-sm"><CardContent className="p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-warning-text">
          {t("envBadge")}
        </p>
        <h1 className="mb-1 mt-1 text-lg font-semibold">{t("chooseIdentity")}</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          {t("desc")}
        </p>

        {error && (
          <Alert variant="destructive" className="mb-3">
            <TriangleAlert className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="max-h-64 space-y-1 overflow-y-auto">
          {users === null ? (
            <p className="text-xs text-muted-foreground">{tCommon("loading")}</p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                onClick={() => login(u.id)}
                disabled={busy}
                className="flex w-full items-center justify-between rounded-md border border-border/60 px-3 py-2.5 text-left text-sm hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
              >
                <span className="font-medium">{u.name}</span>
              </button>
            ))
          )}
        </div>

        <form onSubmit={createAndLogin} className="mt-5 border-t border-border/60 pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t("newUserHint")}
          </p>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="h-8 w-24 text-xs"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={busy || !newName.trim()}
            >
              {t("createAndLogin")}
            </Button>
          </div>
        </form>
      </CardContent></Card>
    </main>
  );
}

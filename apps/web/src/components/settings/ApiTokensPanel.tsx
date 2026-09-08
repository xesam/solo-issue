"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPatch, apiGet, apiDelete } from "@/lib/client/api";
import { SCOPE_OPTIONS } from "./CreateTokenDialog";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { TableShell } from "@/components/ui/table-shell";
import { Pencil, Trash2 } from "lucide-react";

// API 令牌表 + 行内操作（创建弹窗见 CreateTokenDialog；修改 = 重命名）。
// 令牌仅创建时展示一次，库中只存哈希（会话专用；Bearer 禁区）

type TokenRecord = {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

// 列表展示复用创建弹窗的 scope 单源选项表（新 scope 只加一处）
const SCOPE_LABEL: Record<string, string> = Object.fromEntries(
  SCOPE_OPTIONS.map((o) => [o.value, o.labelKey]),
);

export default function ApiTokensPanel() {
  const qc = useQueryClient();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [renameTarget, setRenameTarget] = useState<TokenRecord | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TokenRecord | null>(null);

  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => apiGet<TokenRecord[]>("/api/api-tokens"),
  });

  async function onRename() {
    if (!renameTarget || !renameName.trim()) return;
    setRenameBusy(true);
    try {
      await apiPatch(`/api/api-tokens/${renameTarget.id}`, { name: renameName.trim() });
      toast.success(t("renamedToast"));
      setRenameTarget(null);
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("renameFailed"));
    } finally {
      setRenameBusy(false);
    }
  }

  async function onRevoke() {
    if (!revokeTarget) return;
    const id = revokeTarget.id;
    setRevokeTarget(null);
    try {
      await apiDelete(`/api/api-tokens/${id}`);
      toast.success(t("revokedToast"));
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("revokeFailed"));
    }
  }

  return (
    <div className="space-y-4">
      {/* 令牌列表 */}
      {tokens.isLoading ? (
        <div className="space-y-1" aria-label={t("tokensLoading")}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : tokens.error ? (
        <p className="text-xs text-destructive">{(tokens.error as Error).message}</p>
      ) : !tokens.data?.length ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t("tokensEmptyHint")}
        </p>
      ) : (
        <TableShell>
          <Table>
            <TableHeader className="text-xs text-muted-foreground">
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="px-4 py-2.5">{t("colName")}</TableHead>
                <TableHead className="px-4 py-2.5">{t("colScopes")}</TableHead>
                <TableHead className="px-4 py-2.5">{t("colLastUsed")}</TableHead>
                <TableHead className="px-4 py-2.5">{t("colExpires")}</TableHead>
                <TableHead className="px-4 py-2.5 text-right">{tCommon("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.map((tk) => (
                <TableRow
                  key={tk.id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <TableCell className="max-w-[16rem] truncate px-4 py-2.5 font-medium">
                    {tk.name}
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <span className="flex flex-wrap gap-1">
                      {tk.scopes.map((s) => (
                        <Badge
                          key={s}
                          variant="secondary"
                          className="px-1.5 font-normal text-muted-foreground"
                        >
                          {SCOPE_LABEL[s] ? t(SCOPE_LABEL[s]) : s}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {tk.lastUsedAt ? tk.lastUsedAt.slice(0, 10) : t("neverUsed")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {tk.expiresAt ? `${tk.expiresAt.slice(0, 10)}` : t("neverExpires")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => {
                        setRenameTarget(tk);
                        setRenameName(tk.name);
                      }}
                    >
                      <Pencil className="size-3.5" />
                      {t("rename")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setRevokeTarget(tk)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("revoke")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      )}

      {/* 重命名弹窗：scope/有效期签发即定不可改，修改仅指名称 */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={(v) => {
          if (!v) {
            setRenameTarget(null);
            setRenameName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
            <DialogDescription>
              {t("renameDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="rename-token-name">{t("nameLabel")}</Label>
            <Input
              id="rename-token-name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
              {tCommon("cancel")}
            </Button>
            <Button size="sm" disabled={!renameName.trim() || renameBusy} onClick={onRename}>
              {tCommon("save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 撤销确认：不可逆破坏性操作，走全站 ConfirmDialog */}
      <ConfirmDialog
        open={!!revokeTarget}
        title={t("revokeTitle")}
        description={
          revokeTarget
            ? t("revokeDesc", { name: revokeTarget.name })
            : ""
        }
        confirmLabel={t("revoke")}
        destructive
        onConfirm={onRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}

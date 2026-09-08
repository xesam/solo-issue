"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/client/api";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Copy, Plus } from "lucide-react";

// 新建令牌弹出框：Dialog 承载（与其他设置/管理页一致，弃内联展开）。
// 名称必填（服务端本就 422，客户端提前拦截）；scope/有效期创建后不可改。
// 创建成功后停在同一弹窗展示明文令牌（仅此一次），用户显式关闭确认已保存。

// scope 的可授权清单与中文展示（面板与创建弹窗共用单源）。
// 两道编译期闸（value 越界/清单缺失都当场红）确保与 src/lib/scopes.ts 的 API_SCOPES
// 严格同集——历史上两处各抄一份导致漂移，这正是 scopes.ts 头注警告的形态；
// 新 scope：先加 API_SCOPES，再在这里补一行选项
import { API_SCOPES } from "@/lib/scopes";

type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_OPTIONS = [
  { value: "*", labelKey: "scopeAll" },
  { value: "issues:read", labelKey: "scopeIssuesRead" },
  { value: "issues:write", labelKey: "scopeIssuesWrite" },
  { value: "comments:read", labelKey: "scopeCommentsRead" },
  { value: "comments:write", labelKey: "scopeCommentsWrite" },
  { value: "search:read", labelKey: "scopeSearchRead" },
  { value: "activities:read", labelKey: "scopeActivitiesRead" },
  { value: "projects:read", labelKey: "scopeProjectsRead" },
  { value: "fields:read", labelKey: "scopeFieldsRead" },
  { value: "fields:write", labelKey: "scopeFieldsWrite" },
] as const satisfies readonly { value: ApiScope; labelKey: string }[];

// 完备性断言：清单漏掉任何 API_SCOPES 成员时，_MissingScope 余项非 never，
// 条件类型在此退化为 never，赋值 true 当场编译报错（多写项由上面的 satisfies 拦）
type _MissingScope = Exclude<ApiScope, (typeof SCOPE_OPTIONS)[number]["value"]>;
const _assertAllScopesPresent: _MissingScope extends never ? true : never = true;

const EXPIRY_OPTIONS = [
  { value: "30", days: 30, labelKey: "expiry30" },
  { value: "90", days: 90, labelKey: "expiry90" },
  { value: "365", days: 365, labelKey: "expiryYear" },
  { value: "never", days: null, labelKey: "neverExpires" },
] as const;

export default function CreateTokenDialog() {
  const qc = useQueryClient();
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["issues:read"]);
  const [expiry, setExpiry] = useState<string>("90");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false); // 复制按钮的短时视觉反馈
  const [copyConfirmed, setCopyConfirmed] = useState(false); // 已复制过一次：允许安全关闭的判定（不复位）
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const allScopes = scopes.includes("*");
  const canSubmit = !!name.trim() && scopes.length > 0 && !busy && !created;

  function toggleScope(v: string) {
    setScopes((prev) =>
      v === "*"
        ? prev.includes("*")
          ? []
          : ["*"]
        : prev.includes(v)
          ? prev.filter((s) => s !== v)
          : [...prev.filter((s) => s !== "*"), v],
    );
  }

  async function onCreate() {
    setBusy(true);
    setError("");
    try {
      const days = EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days ?? null;
      const rec = await apiPost<{ token: string }>("/api/api-tokens", {
        name: name.trim(),
        scopes,
        ...(days ? { expiresInDays: days } : {}),
      });
      setCreated(rec.token);
      await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  function onOpenChange(v: boolean) {
    if (v) {
      setName("");
      setScopes(["issues:read"]);
      setExpiry("90");
    } else {
      // 关闭必须清明文（所有关闭路径——ESC/遮罩/X 与「我已保存」都在此汇合）：
      // 不清则重开弹窗直接展示上一次令牌，兑现不了「仅创建时可见一次」的承诺
      setCreated(null);
    }
    setCopied(false);
    setCopyConfirmed(false);
    setError("");
    setOpen(v);
  }

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
      setCopyConfirmed(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 非 HTTPS / 剪贴板权限拒绝都走这里——复制是本弹窗的关键动作，失败必须给出口
      toast.error(t("copyFailed"));
    }
  }

  return (
    // 明文未复制时拦截 ESC/遮罩的意外关闭——关闭即清明文，一次性令牌将不可再取
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && created && !copyConfirmed) {
          toast.warning(t("copyBeforeCloseHint"));
          return;
        }
        onOpenChange(v);
      }}
    >
      <Button size="sm" onClick={() => onOpenChange(true)} className="shrink-0">
        <Plus className="size-3.5" />
        {t("createToken")}
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? t("createdTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription>
            {created ? t("createdDesc") : t("createDesc")}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-2 font-mono text-xs">
                {created}
              </code>
              <Button size="sm" variant="outline" className="shrink-0" onClick={copyToken}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? t("copied") : t("copy")}
              </Button>
            </div>
            <Button
              onClick={() => {
                if (!copied) toast.info(t("copyBeforeCloseHint"));
                onOpenChange(false);
              }}
            >
              {t("savedAndClose")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1">
              <Label htmlFor="token-name">{t("nameLabel")}</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) onCreate();
                }}
                placeholder={t("namePlaceholder")}
                autoFocus
              />
            </div>
            <div className="grid gap-1">
              <Label>{t("scopesLabel")}</Label>
              <div className="grid gap-1">
                {SCOPE_OPTIONS.map((o) => {
                  const checked = allScopes ? o.value === "*" : scopes.includes(o.value);
                  return (
                    <label
                      key={o.value}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={allScopes && o.value !== "*"}
                        onCheckedChange={() => toggleScope(o.value)}
                      />
                      {t(o.labelKey)}
                    </label>
                  );
                })}
              </div>
              {allScopes && (
                <p className="text-xs text-warning-text">
                  {t("allScopesHint")}
                </p>
              )}
            </div>
            <div className="grid gap-1">
              <Label>{t("expiryLabel")}</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button size="sm" disabled={!canSubmit} onClick={onCreate}>
                {busy ? tCommon("creating") : t("createToken")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

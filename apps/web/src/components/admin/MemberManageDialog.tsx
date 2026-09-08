"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/client/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TableEmptyRow } from "@/components/ui/table-shell";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import MemberCombobox from "@/components/members/MemberCombobox";
import type { UserOrigin } from "@prisma/client";
import type { MemberDTO } from "@/lib/client/api";
import { credentialHint } from "@/lib/origin-labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";

// 工作区方向的成员管理（与用户页「加入工作区」对等——同一张 WorkspaceMember 表）：
// 当前成员改角色/移除，候选=活跃且尚未加入的账号。
// 护栏（工作区最后一个 OWNER）由后端 adminSetWorkspaceRole 强制，前端展示错误信息。

type Member = {
  userId: string;
  name: string;
  email: string | null;
  origin: UserOrigin;
  isActive: boolean;
  role: "OWNER" | "MEMBER" | "GUEST";
};

type Candidate = {
  id: string;
  name: string;
  email: string | null;
  origin: UserOrigin;
  avatarUrl: string | null;
};

export default function MemberManageDialog({
  ws,
  open,
  onOpenChange,
}: {
  ws: { id: string; slug: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const tLabels = useTranslations("labels");
  const [removing, setRemoving] = useState<Member | null>(null);
  // 添加成员的暂存区：combobox 勾选 → 「添加」一次性提交（批量 = 客户端循环复用单条接口）
  const [pending, setPending] = useState<string[]>([]);

  const data = useQuery({
    queryKey: ["admin-ws-members", ws?.id],
    queryFn: () => apiGet<{ members: Member[]; candidates: Candidate[] }>(`/api/admin/workspaces/${ws?.id}/members`),
    enabled: open && !!ws,
  });

  // 与用户页同款：治理操作后三个缓存一起失效（成员列表 / 工作区成员数 / 用户表角色列）
  async function act(fn: () => Promise<unknown>, okMsg?: string) {
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-ws-members", ws?.id] }),
        qc.invalidateQueries({ queryKey: ["admin-workspaces"] }),
        qc.invalidateQueries({ queryKey: ["admin-users"] }),
      ]);
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("operationFailed"));
    }
  }

  function setRole(userId: string, role: string) {
    if (!ws) return;
    void act(async () => {
      await apiPost(`/api/admin/users/${userId}/roles`, { wsSlug: ws.slug, role });
    });
  }

  // 批量加入：逐个复用 roles 接口（内部工具量级，不做批量端点）；统计失败数汇总提示
  async function addPending() {
    if (!ws || !pending.length) return;
    const ids = [...pending];
    setPending([]);
    let failed = 0;
    for (const userId of ids) {
      try {
        await apiPost(`/api/admin/users/${userId}/roles`, { wsSlug: ws.slug, role: "MEMBER" });
      } catch {
        failed++;
      }
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-ws-members", ws.id] }),
      qc.invalidateQueries({ queryKey: ["admin-workspaces"] }),
      qc.invalidateQueries({ queryKey: ["admin-users"] }),
    ]);
    if (!failed) toast.success(t("membersAddedToast", { count: ids.length }));
    else toast.error(t("membersAddedPartialToast", { added: ids.length - failed, failed }));
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setRemoving(null); setPending([]); } onOpenChange(o); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("membersTitle", { name: ws?.name ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("membersDesc")}
            </DialogDescription>
          </DialogHeader>

          {/* 成员表：弹框内表格走 §9.4b 去壳范式——DialogContent 本身就是那张卡，
              套 §9.2 三件套外壳会形成「框中框」；场景边界：成员只从存量账号中挑选绑定
              （不产出新实体），符合 §9.4 边界精确化，可在弹框内承载 */}
          <div className="max-h-96 overflow-y-auto">
            <Table className="w-full text-sm">
              <TableHeader className="text-xs text-muted-foreground">
                <TableRow>
                  <TableHead className="px-4 py-2.5 font-medium">{t("colMember")}</TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">{t("colStatus")}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t("colRole")}</TableHead>
                  <TableHead className="px-4 py-2.5 text-right">{tCommon("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={`sk-${i}`} className="border-b border-border/60">
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="px-4 py-3"><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    </TableRow>
                  ))}
                {(data.data?.members ?? []).map((m) => (
                  <TableRow key={m.userId} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <TableCell className="max-w-xs px-4 py-2.5">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {credentialHint(tLabels, m)}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      <Badge variant={m.isActive ? "secondary" : "destructive"}>
                        {m.isActive ? t("badgeActive") : t("badgeDisabled")}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <Select value={m.role} onValueChange={(role) => setRole(m.userId, role)}>
                        <SelectTrigger
                          size="sm"
                          className="h-6 w-20 gap-0.5 border-0 bg-transparent px-1 text-xs shadow-none hover:bg-transparent focus:ring-0"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OWNER">{t("roleOwner")}</SelectItem>
                          <SelectItem value="MEMBER">{t("roleMember")}</SelectItem>
                          <SelectItem value="GUEST">{t("roleGuest")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoving(m)}
                      >
                        {t("removeFromWs")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!data.isLoading && data.isError && (
                  <TableEmptyRow colSpan={4} className="text-destructive">
                    {t("loadFailedCloseRetry")}
                  </TableEmptyRow>
                )}
                {!data.isLoading && !data.isError && (data.data?.members.length ?? 0) === 0 && (
                  <TableEmptyRow colSpan={4}>{t("noMembers")}</TableEmptyRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* 添加成员：候选 = 活跃且尚未加入的账号（不支持在此建号，建号在用户页）。
              多选 = 复用 MemberCombobox 暂存 chips，点「添加」一次性提交（§6.1 双闸：未选置灰），
              逐个复用 roles 接口，失败逐个汇总 */}
          {!data.isLoading && data.data &&
            (data.data.candidates.length ? (
              <div className="flex items-start gap-2">
                <MemberCombobox
                  variant="staging"
                  className="min-w-0 flex-1"
                  members={data.data.candidates.map((c) => ({ id: c.id, role: "MEMBER", user: c }) as MemberDTO)}
                  selected={pending}
                  onChange={setPending}
                  placeholder={t("memberPickerPlaceholder")}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  disabled={!pending.length}
                  onClick={addPending}
                >
                  <Plus className="size-3.5" />
                  {t("addMembers")}
                  {pending.length > 1 ? t("countSuffix", { count: pending.length }) : ""}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("noCandidates")}
              </p>
            ))}

          <div className="flex justify-end">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">{t("close")}</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      {/* 移出确认：不可逆操作点名目标（ui-guidelines §2 破坏性操作） */}
      <ConfirmDialog
        open={!!removing}
        title={t("removeFromWsTitle", { name: removing?.name ?? "", ws: ws?.name ?? "" })}
        description={t("removeFromWsDesc")}
        confirmLabel={t("removeFromWs")}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const r = removing;
          setRemoving(null);
          if (r)
            void act(async () => {
              await apiPost(`/api/admin/users/${r.userId}/roles`, {
                wsSlug: ws?.slug,
                role: null,
              });
            });
        }}
      />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPatch, apiPost } from "@/lib/client/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";
import PageHeader from "@/components/shell/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyRound, Pencil, Plus, RefreshCw, UserPlus } from "lucide-react";
import type { UserOrigin } from "@prisma/client";
import { originLabel } from "@/lib/origin-labels";

// 用户治理（超管与业务正交——不穿透业务，只管用户与角色）：搜索/过滤/分页 + 建号 /
// 编辑（姓名/邮箱）/ 停用启用 / 授撤超管 / 重置密码 / 工作区角色。
// 护栏（最后一个活跃管理员 / 工作区最后一个 OWNER）由后端强制，前端展示错误信息。

type AdminUser = {
  id: string;
  name: string;
  email: string | null;
  origin: UserOrigin;
  isActive: boolean;
  isAdmin: boolean;
  mustChangePassword: boolean;
  hasPassword: boolean;
  memberships: { workspaceId: string; wsSlug: string; wsName: string; role: string }[];
};

type Workspace = {
  id: string;
  slug: string;
  name: string;
  _count?: { members: number; projects: number };
};

// 生成初始密码：crypto.getRandomValues（Math.random 可被观察反推，不该用于口令）。
// 拒绝采样消 256 % 62 的取模偏差：>= 248（62*4）的直接弃掉重抽
function genPassword() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let body = "";
  while (body.length < 12) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= 248) continue;
      body += alphabet[b % alphabet.length];
      if (body.length === 12) break;
    }
  }
  return `It@${body}`;
}

export default function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const tLabels = useTranslations("labels");
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPw, setResetPw] = useState("");
  // 编辑（姓名/邮箱）：邮箱是登录键——占位管理员邮箱修正与 IM 建号补写（5.5 形态 A）的统一入口
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "" });
  // 移出工作区是不可逆破坏性操作：走全站 ConfirmDialog（ui-guidelines §2），并切断待加入区同一行为
  const [removing, setRemoving] = useState<{ user: AdminUser; wsName: string; wsSlug: string } | null>(null);

  // U3.3：搜索/过滤/分页（防抖 350ms；take 50）
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "disabled">("all");
  const [adminOnly, setAdminOnly] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const users = useQuery({
    queryKey: ["admin-users", qDebounced, status, adminOnly, page],
    queryFn: () =>
      apiGet<{ total: number; users: AdminUser[]}>(
        // status=all 时省略参数（服务端只认 active/disabled，"all" 是纯 UI 档位）
        `/api/admin/users?q=${encodeURIComponent(qDebounced)}${status === "all" ? "" : `&status=${status}`}&adminOnly=${adminOnly}&take=${PAGE_SIZE}&skip=${page * PAGE_SIZE}`,
      ),
  });
  // 建号默认 memberships（main 设选定角色，其余工作区 MEMBER）与角色列「加入工作区」都需要工作区表
  const workspaces = useQuery({
    queryKey: ["admin-workspaces"],
    queryFn: () => apiGet<Workspace[]>("/api/admin/workspaces"),
  });

  // 治理操作后同时失效两个缓存：角色/建号改动会影响工作区成员数，工作区重命名会改用户表角色列的 wsName
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["admin-users"] });
    await qc.invalidateQueries({ queryKey: ["admin-workspaces"] });
  }

  // 执行并统一兜错/刷新/成功提示；返回是否成功——收尾（关弹窗、清输入）必须
  // 依成功与否决定，先关后败会把失败伪装成成功
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> {
    if (busy) return false; // 弹窗提交与行内操作统一闸：飞行中重入（双击/双确认）直接否决
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (okMsg) toast.success(okMsg);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("operationFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ── 建号 ──
  const [form, setForm] = useState({
    name: "",
    email: "",
    initialPassword: genPassword(),
    isAdmin: false,
    role: "MEMBER" as "OWNER" | "MEMBER" | "GUEST",
  });
  // 停用/撤超管等高危开关的二次确认载荷（执行体在确认时跑）
  const [toggle, setToggle] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
    run: () => Promise<void>;
  } | null>(null);

  async function createUser() {
    const ok = await act(
      async () => {
        const memberships =
          workspaces.data?.map((w) => ({
            wsSlug: w.slug,
            role: w.slug === "main" ? form.role : ("MEMBER" as const),
          })) ?? [];
        await apiPost("/api/admin/users", {
          name: form.name,
          email: form.email,
          initialPassword: form.initialPassword,
          isAdmin: form.isAdmin,
          memberships: memberships.length ? memberships : undefined,
        });
      },
      t("createdUserToast", { name: form.name }),
    );
    if (ok) {
      setShowCreate(false);
      // 一次性明文凭据纪律（ui-guidelines §9.3）：重开弹窗不携带上次明文（随机初始密码重掷）
      setForm({ name: "", email: "", initialPassword: genPassword(), isAdmin: false, role: "MEMBER" });
    }
  }

  async function doReset() {
    if (!resetTarget) return;
    const ok = await act(async () => {
      await apiPost(`/api/admin/users/${resetTarget.id}/reset-password`, {
        newPassword: resetPw,
      });
    }, t("passwordResetToast"));
    if (ok) {
      setResetTarget(null);
      setResetPw("");
    }
  }

  // 开编辑弹窗：预填当前姓名/邮箱（IM 建号 email 为 null → 空串占位）
  function openEdit(u: AdminUser) {
    setEditTarget(u);
    setEditForm({ name: u.name, email: u.email ?? "" });
  }

  // 保存编辑：邮箱留空 = 清空密码登录通道（有密码账号会被服务端 422 拦下）——
  // 双闸：姓名空值置灰提交 + 服务端 zod/查重兜底
  async function doEdit() {
    if (!editTarget) return;
    const ok = await act(async () => {
      await apiPatch(`/api/admin/users/${editTarget.id}`, {
        name: editForm.name,
        email: editForm.email.trim() || null,
      });
    }, tCommon("saved"));
    if (ok) setEditTarget(null);
  }

  return (
    <div>
      {/* 页头：分区标题 + 主操作（拆区后每页一个主入口，不再与工作区操作混在一行） */}
      <PageHeader title={t("users")} className="px-8 py-6">
        {/* 建号：Dialog 弹出框（UI 验收定案，弃内联展开） */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="size-3.5" />
              {t("newUser")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("newUser")}</DialogTitle>
              <DialogDescription>{t("newUserDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-1">
                <Label htmlFor="new-user-name">{t("nameLabel")}</Label>
                <Input
                  id="new-user-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t("namePlaceholder")}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="new-user-email">{t("emailLabel")}</Label>
                <Input
                  id="new-user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="name@example.com"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="new-user-password">{t("initialPasswordLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="new-user-password"
                    value={form.initialPassword}
                    onChange={(e) => setForm({ ...form, initialPassword: e.target.value })}
                  />
                  <Button variant="secondary" className="shrink-0" onClick={() => setForm({ ...form, initialPassword: genPassword() })}>
                    {t("random")}
                  </Button>
                </div>
              </div>
              <div className="grid gap-1">
                <Label>{t("defaultRoleLabel")}</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">{t("roleMember")}</SelectItem>
                  <SelectItem value="GUEST">{t("roleGuestReadOnly")}</SelectItem>
                  <SelectItem value="OWNER">{t("roleOwner")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.isAdmin}
                  onCheckedChange={(v) => setForm({ ...form, isAdmin: v })}
                />
                {t("alsoAdminHint")}
              </label>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{tCommon("cancel")}</Button>
              </DialogClose>
              <Button
                disabled={
                  busy ||
                  !form.name.trim() || !form.email.trim() || form.initialPassword.length < 8
                }
                onClick={createUser}
              >
                {t("createUser")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>
      <div className="px-8 py-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-8 w-56 text-sm"
        />
        <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(0); }}>
          <SelectTrigger size="sm" className="w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAll")}</SelectItem>
            <SelectItem value="active">{t("filterActive")}</SelectItem>
            <SelectItem value="disabled">{t("filterDisabled")}</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={adminOnly}
            onCheckedChange={(c) => { setAdminOnly(!!c); setPage(0); }}
          />
          {t("adminOnly")}
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {users.isLoading
            ? t("paginationLoading", { page: page + 1 })
            : t("paginationCount", { count: users.data?.total ?? 0, page: page + 1 })}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={page === 0 || users.isLoading}
          onClick={() => setPage((p) => p - 1)}
        >
          {t("prevPage")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={!users.data || (page + 1) * PAGE_SIZE >= users.data.total || users.isLoading}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("nextPage")}
        </Button>
      </div>
      <TableShell>
        <Table className="w-full text-sm">
          <TableHeader className="text-xs text-muted-foreground">
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="px-4 py-2.5 font-medium">{t("users")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colStatus")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colRoles")}</TableHead>
              <TableHead className="px-4 py-2.5 text-right">{tCommon("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`sk-${i}`} className="border-b border-border/60">
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))}
            {(users.data?.users ?? []).length === 0 && !users.isLoading && (
              <TableEmptyRow colSpan={4}>{t("noMatchUsers")}</TableEmptyRow>
            )}
            {!users.data && !users.isLoading && (
              <TableEmptyRow colSpan={4} className="text-destructive">
                {t("loadFailedRetry")}
              </TableEmptyRow>
            )}
            {(users.data?.users ?? []).map((u) => (
              <TableRow key={u.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                <TableCell className="px-4 py-2.5">
                  <p className="font-medium">
                    {u.name}
                    {u.id === currentUserId && <span className="ml-1 text-xs text-muted-foreground">{t("youMarker")}</span>}
                  </p>
                  {/* 凭据标识槽位（docs/02 §5，判据与 origin-labels 的 credentialHint 同口径）：
                      IM 建号显示建号渠道徽章；邮箱建号保留 email 文本（其登录键） */}
                  {u.origin && u.origin !== "EMAIL" ? (
                    <Badge variant="outline" className="mt-0.5 h-5 px-1.5 text-xs font-normal text-muted-foreground">
                      {originLabel(tLabels, u.origin)}
                    </Badge>
                  ) : (
                    <p className="text-xs text-muted-foreground">{u.email ?? t("noEmail")}</p>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2.5 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Badge variant={u.isActive ? "secondary" : "destructive"}>
                      {u.isActive ? t("badgeActive") : t("badgeDisabled")}
                    </Badge>
                    {u.isAdmin && (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        {t("adminBadge")}
                      </Badge>
                    )}
                    {u.mustChangePassword && (
                      <Badge variant="secondary" className="bg-warning-subtle text-warning-text">
                        {t("pendingPasswordChange")}
                      </Badge>
                    )}
                    {!u.hasPassword && (
                      <Badge variant="secondary" className="bg-warning-subtle text-warning-text">
                        {t("noPassword")}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  {u.memberships.length ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {u.memberships.map((m) => (
                        <span key={m.workspaceId} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs">
                          {m.wsName}
                          <Select
                            value={m.role}
                            onValueChange={(role) =>
                              act(async () => {
                                await apiPost(`/api/admin/users/${u.id}/roles`, {
                                  wsSlug: m.wsSlug,
                                  role,
                                });
                              })
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className="h-6 gap-0.5 border-0 bg-transparent px-1 text-xs shadow-none hover:bg-transparent focus:ring-0"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="OWNER">{t("roleOwner")}</SelectItem>
                              <SelectItem value="MEMBER">{t("roleMember")}</SelectItem>
                              <SelectItem value="GUEST">{t("roleGuest")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <button
                            className="text-muted-foreground hover:text-destructive"
                            title={t("removeFromWorkspace")}
                            aria-label={t("removeFromWorkspace")}
                            onClick={() =>
                              setRemoving({ user: u, wsName: m.wsName, wsSlug: m.wsSlug })
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {workspaces.data && u.memberships.length < workspaces.data.length && (
                        <Select
                          value=""
                          onValueChange={(wsSlug) => {
                            if (!wsSlug) return;
                            act(async () => {
                              await apiPost(`/api/admin/users/${u.id}/roles`, {
                                wsSlug,
                                role: "MEMBER",
                              });
                            });
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={t("addToWorkspace")}
                            className="h-6 gap-1 border-dashed px-1.5 text-xs text-muted-foreground"
                          >
                            <Plus className="size-3" aria-hidden />
                            <SelectValue placeholder={t("addToWorkspacePlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            {workspaces.data
                              .filter((w) => !u.memberships.some((m) => m.workspaceId === w.id))
                              .map((w) => (
                                <SelectItem key={w.id} value={w.slug}>
                                  {w.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ) : (
                    <Select
                      value=""
                      onValueChange={(wsSlug) => {
                        if (!wsSlug) return;
                        act(async () => {
                          await apiPost(`/api/admin/users/${u.id}/roles`, { wsSlug, role: "MEMBER" });
                        });
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={t("addToWorkspace")}
                        className="h-6 gap-1 border-dashed px-1.5 text-xs text-muted-foreground"
                      >
                        <Plus className="size-3" aria-hidden />
                        <SelectValue placeholder={t("addToWorkspacePlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(workspaces.data ?? []).map((w) => (
                          <SelectItem key={w.id} value={w.slug}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="px-4 py-2.5 text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => openEdit(u)}
                    >
                      <Pencil className="size-3" />
                      {tCommon("edit")}
                    </Button>
                    {/* 无邮箱账号（IM 建号）禁用重置：按钮 disabled 带 pointer-events-none，title 挂在外层 span 才能悬停 */}
                    <span
                      className="inline-flex"
                      title={u.email ? undefined : t("resetNoEmailHint")}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        disabled={!u.email}
                        onClick={() => {
                          setResetTarget(u);
                          setResetPw("");
                        }}
                      >
                        <KeyRound className="size-3" />
                        {t("resetPassword")}
                      </Button>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() =>
                        setToggle({
                          title: u.isActive ? t("disableTitle", { name: u.name }) : t("enableTitle", { name: u.name }),
                          description: u.isActive ? t("disableDesc") : t("enableDesc"),
                          confirmLabel: u.isActive ? t("disable") : t("enable"),
                          destructive: u.isActive,
                          run: async () => {
                            await act(async () => {
                              await apiPatch(`/api/admin/users/${u.id}`, { isActive: !u.isActive });
                            }, u.isActive ? t("disabledToast") : t("enabledToast"));
                          },
                        })
                      }
                    >
                      {u.isActive ? t("disable") : t("enable")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() =>
                        setToggle({
                          title: u.isAdmin ? t("revokeAdminTitle", { name: u.name }) : t("grantAdminTitle", { name: u.name }),
                          description: u.isAdmin ? t("revokeAdminDesc") : t("grantAdminDesc"),
                          confirmLabel: u.isAdmin ? t("confirmRevoke") : t("confirmGrant"),
                          destructive: u.isAdmin,
                          run: async () => {
                            await act(async () => {
                              await apiPatch(`/api/admin/users/${u.id}`, { isAdmin: !u.isAdmin });
                            });
                          },
                        })
                      }
                    >
                      {u.isAdmin ? t("revokeSuperAdmin") : t("grantSuperAdmin")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>

      {/* 移出确认：不可逆操作点名目标（ui-guidelines §2 破坏性操作） */}
      <ConfirmDialog
        open={!!removing}
        title={t("removeFromWsTitle", { name: removing?.user.name ?? "", ws: removing?.wsName ?? "" })}
        description={t("removeFromWsDesc")}
        confirmLabel={t("removeFromWs")}
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const r = removing;
          setRemoving(null);
          if (r)
            void act(async () => {
              await apiPost(`/api/admin/users/${r.user.id}/roles`, {
                wsSlug: r.wsSlug,
                role: null,
              });
            });
        }}
       />

      {/* 停用/授/撤超管：单击只开确认，确认后执行（ui-guidelines §2）；
          服务端护栏（最后一个活跃超管 422）出面时由 act 统一 toast */}
      <ConfirmDialog
        open={!!toggle}
        title={toggle?.title ?? ""}
        description={toggle?.description}
        confirmLabel={toggle?.confirmLabel ?? tCommon("confirm")}
        destructive={toggle?.destructive}
        onCancel={() => setToggle(null)}
        onConfirm={() => {
          const t = toggle;
          setToggle(null);
          if (t) void t.run();
        }}
      />

      {/* 重置密码：Radix Dialog（ui-guidelines「弹窗一律 Dialog」——打断式操作） */}
      <Dialog
        open={!!resetTarget}
        onOpenChange={(o) => {
          if (!o) {
            setResetTarget(null);
            setResetPw("");
          }
        }}
      >
        <DialogContent className="max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("resetPasswordTitle", { name: resetTarget?.name ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("resetPasswordDesc")}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            placeholder={t("newPasswordPlaceholder")}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => setResetPw(genPassword())}>
              <RefreshCw className="size-3.5" />
              {t("generateRandom")}
            </Button>
            <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setResetTarget(null);
                setResetPw("");
              }}
            >
              {tCommon("cancel")}
            </Button>
            <Button size="sm" disabled={busy || resetPw.length < 8} onClick={doReset}>
              {t("resetPasswordConfirm")}
            </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 编辑用户：姓名+邮箱（登录键可变——占位管理员邮箱修正 / IM 建号补写即 5.5 形态 A） */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      >
        <DialogContent className="max-w-sm" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("editUserTitle", { name: editTarget?.name ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("editUserDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1">
              <Label htmlFor="edit-user-name">{t("nameLabel")}</Label>
              <Input
                id="edit-user-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="edit-user-email">{t("emailLabel")}</Label>
              <Input
                id="edit-user-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                placeholder="name@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{tCommon("cancel")}</Button>
            </DialogClose>
            <Button size="sm" disabled={busy || !editForm.name.trim()} onClick={doEdit}>
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

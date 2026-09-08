"use client";

import { useState } from "react";
import Link from "next/link";
import type { State } from "@prisma/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiDelete, apiGet, apiPatch, apiPost, useMembers, useStates, type MemberDTO } from "@/lib/client/api";
import { credentialHint } from "@/lib/origin-labels";
import { withBase } from "@/lib/base-path";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import MemberCombobox from "@/components/members/MemberCombobox";
import ProjectBasicTab from "@/components/project/ProjectBasicTab";
import ProjectAdvancedTab from "@/components/project/ProjectAdvancedTab";
import CustomFieldsTab from "@/components/project/CustomFieldsTab";
import { ArrowLeft, Plus, X } from "lucide-react";

// 项目设置页：原弹窗整改为页面级——长列表（状态/成员）脱离 70vh 弹窗内滚动，
// 全站范式：页面 = §9.2 表格三件套 + 页头主操作弹 Dialog（§9.1）。

// 状态分组（三档结局分类）：行为决定主干——COMPLETED 驱动 completedAt、
// CANCELLED 与 COMPLETED 共同决定“待我处理”排除；阶段词汇由项目级状态名表达
const GROUP_LABEL: Record<string, string> = {
  ACTIVE: "groupActive",
  COMPLETED: "groupCompleted",
  CANCELLED: "groupCancelled",
};

// §6.2 内部枚举过 label 映射，禁止裸值上屏
const PROJECT_ROLE_LABEL: Record<string, string> = {
  ADMIN: "roleAdmin",
  MEMBER: "roleMember",
  GUEST: "roleGuest",
};

type ProjectMemberRow = {
  userId: string;
  role: string;
  user: { id: string; name: string; email: string | null };
};

export default function ProjectSettingsPage({
  projectId,
  wsSlug,
  projectSlug,
  projectName,
  projectIsPrivate,
  canManage,
}: {
  projectId: string;
  wsSlug: string;
  projectSlug: string;
  projectName: string;
  projectIsPrivate: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const tTopbar = useTranslations("topbar");
  const [tab, setTab] = useState<string>("basic");
  const [isPrivate, setIsPrivate] = useState(projectIsPrivate);

  const states = useStates(projectId);
  const members = useMembers(wsSlug);
  const pmQuery = useQuery({
    queryKey: ["projectMembers", projectId],
    queryFn: () => apiGet<ProjectMemberRow[]>(`/api/projects/${projectId}/members`),
    enabled: isPrivate === true,
  });

  function refreshStates() {
    qc.invalidateQueries({ queryKey: ["states", projectId] });
  }

  async function togglePrivate(next: boolean) {
    try {
      await apiPatch(`/api/projects/${projectId}`, { isPrivate: next });
      setIsPrivate(next);
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (next) pmQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("operationFailed"));
    }
  }

  const backHref = `/w/${wsSlug}/p/${projectSlug}`;

  return (
    <div className="px-8 py-6">
      {/* 面包屑：与 IssueShell（编辑/创建问题页）同款——行首返回按钮 + 项目名 / 设置 */}
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t("backTo", { name: projectName })}
          title={t("backTo", { name: projectName })}
        >
          <Link href={backHref}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <Link href={backHref} className="hover:text-primary">
          {projectName}
        </Link>
        <span className="mx-1.5 text-muted-foreground/40">/</span>
        <span className="text-muted-foreground/70">{tTopbar("settings")}</span>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-6">
        <TabsList>
          <TabsTrigger value="basic">{t("tabBasic")}</TabsTrigger>
          <TabsTrigger value="states">{t("tabStates")}</TabsTrigger>
          <TabsTrigger value="fields">{t("tabFields")}</TabsTrigger>
          <TabsTrigger value="advanced">{t("tabAdvanced")}</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="mt-0 space-y-6">
          <ProjectBasicTab
            projectId={projectId}
            onRenamed={() => qc.invalidateQueries({ queryKey: ["projects"] })}
          />

          {/* 项目类型与成员管理强关联：成员管理是「私有项目」值的展开结果——
              同卡片从属 + 切换即时滑入，视觉上表达从属与因果 */}
          <section className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between rounded-t-xl bg-muted/50 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{t("projectTypeTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("projectTypeDesc")}
                </p>
              </div>
              <Tabs
                value={isPrivate ? "private" : "public"}
                onValueChange={(v) => canManage && togglePrivate(v === "private")}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="public" disabled={!canManage}>
                    {t("publicProject")}
                  </TabsTrigger>
                  <TabsTrigger value="private" disabled={!canManage}>
                    {t("privateProject")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {isPrivate && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-200 p-4">
                <MembersSection
                  projectId={projectId}
                  members={members.data}
                  projectMembers={pmQuery.data}
                  canManage={canManage}
                  onRefresh={() => pmQuery.refetch()}
                />
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="states" className="mt-0">
          <StatesSection
            projectId={projectId}
            states={states.data}
            canManage={canManage}
            onRefresh={refreshStates}
          />
        </TabsContent>

        <TabsContent value="fields" className="mt-0">
          <CustomFieldsTab projectId={projectId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="advanced" className="mt-0">
          <ProjectAdvancedTab
            projectId={projectId}
            projectSlug={projectSlug}
            onArchived={() => {
              qc.invalidateQueries({ queryKey: ["projects"] });
              toast.success(t("archivedToast"));
            }}
            onDeleted={() => {
              qc.invalidateQueries({ queryKey: ["projects"] });
              window.location.assign(withBase(`/w/${wsSlug}`));
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── 状态管理：表格三件套 + 页头主操作弹 Dialog（§9.1/§9.2）── */

function StatesSection({
  projectId,
  states,
  canManage,
  onRefresh,
}: {
  projectId: string;
  states: State[] | undefined;
  // 状态是项目级工作流定义：管理归项目负责人（∨工作区 OWNER），与服务端
  // requireProjectAdmin 同口径——普通 MEMBER 只读，不给"能点保存"的错觉
  canManage: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const [creating, setCreating] = useState(false);
  const [newState, setNewState] = useState({ name: "", color: "#64748b", group: "ACTIVE" });
  const [removing, setRemoving] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!newState.name.trim()) return;
    setSaving(true);
    try {
      await apiPost(`/api/projects/${projectId}/states`, newState);
      onRefresh();
      setNewState({ name: "", color: "#64748b", group: "ACTIVE" });
      setCreating(false);
      toast.success(t("stateCreatedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(state: State) {
    try {
      await apiDelete(`/api/projects/${projectId}/states/${state.id}`);
      onRefresh();
      setRemoving(null);
      toast.success(t("stateRemovedToast", { name: state.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("removeFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("statesSummary", { count: states?.length ?? 0 })}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t("newState")}
          </Button>
        )}
      </div>

      <TableShell>
        <Table className="w-full text-xs">
          <TableHeader className="text-xs text-muted-foreground">
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="px-4 py-2.5 font-medium">{t("colColor")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colName")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colGroup")}</TableHead>
              <TableHead className="px-4 py-2.5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(states ?? []).length === 0 && (
              <TableEmptyRow colSpan={4}>{t("noStates")}</TableEmptyRow>
            )}
            {(states ?? []).map((s) => (
              <StateRow
                key={s.id}
                state={s}
                canManage={canManage}
                onSave={async (patch) => {
                  try {
                    await apiPatch(`/api/projects/${projectId}/states/${s.id}`, patch);
                    onRefresh();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : t("saveFailed"));
                  }
                }}
                onDelete={() => setRemoving(s)}
              />
            ))}
          </TableBody>
        </Table>
      </TableShell>

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newState")}</DialogTitle>
            <DialogDescription>
              {t("newStateDesc")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="new-state-color">{t("colColor")}</Label>
              <input
                id="new-state-color"
                type="color"
                value={newState.color}
                onChange={(e) => setNewState({ ...newState, color: e.target.value })}
                className="h-9 w-14 rounded-md border border-input"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-state-name">{t("colName")}</Label>
              <Input
                id="new-state-name"
                value={newState.name}
                onChange={(e) => setNewState({ ...newState, name: e.target.value })}
                placeholder={t("stateNamePlaceholder")}
              />
            </div>
            <div className="grid gap-1">
              <Label>{t("groupLabel")}</Label>
              <Select
                value={newState.group}
                onValueChange={(v) => setNewState({ ...newState, group: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GROUP_LABEL).map(([v, labelKey]) => (
                    <SelectItem key={v} value={v}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={!newState.name.trim() || saving}>
                {tCommon("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        title={t("removeState")}
        description={t("removeStateDesc", { name: removing?.name ?? "" })}
        confirmLabel={t("remove")}
        destructive
        onConfirm={() => removing && remove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function StateRow({
  state,
  canManage,
  onSave,
  onDelete,
}: {
  state: State;
  canManage: boolean;
  onSave: (patch: { name?: string; color?: string }) => Promise<void> | void;
  onDelete: () => void;
}) {
  const t = useTranslations("project");
  const [name, setName] = useState(state.name);
  const [color, setColor] = useState(state.color);
  const dirty = color !== state.color || name !== state.name;
  return (
    <TableRow className="border-b border-border/60 last:border-0 hover:bg-muted/40">
      <TableCell className="px-4 py-2.5">
        <input
          type="color"
          value={color}
          disabled={!canManage}
          onChange={(e) => setColor(e.target.value)}
          onBlur={() => dirty && canManage && onSave({ name, color })}
          className="h-7 w-10 rounded-md border border-input"
        />
      </TableCell>
      <TableCell className="px-4 py-2.5">
        <input
          value={name}
          disabled={!canManage}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => dirty && canManage && onSave({ name, color })}
          className="w-full rounded-md border border-transparent px-1.5 py-1 text-xs hover:border-border focus:border-ring focus:outline-none disabled:opacity-50"
        />
      </TableCell>
      <TableCell className="px-4 py-2.5 text-muted-foreground">
        {t(GROUP_LABEL[state.group] ?? state.group)}
      </TableCell>
      <TableCell className="px-4 py-2.5 text-right">
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground/60 hover:text-destructive"
            onClick={onDelete}
            title={t("removeState")}
            aria-label={t("removeStateAria", { name: state.name })}
          >
            <X className="size-3.5" />
            {t("remove")}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

/* ── 成员管理：表格三件套 + MemberCombobox（可搜，人数多也能定位）── */

function MembersSection({
  projectId,
  members,
  projectMembers,
  canManage,
  onRefresh,
}: {
  projectId: string;
  members: MemberDTO[] | undefined;
  projectMembers: ProjectMemberRow[] | undefined;
  canManage: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const tLabels = useTranslations("labels");
  const [addId, setAddId] = useState<string[]>([]);
  const [removing, setRemoving] = useState<ProjectMemberRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingDlg, setAddingDlg] = useState(false);

  // 弹框内一次多选，逐个以默认角色 MEMBER 加入；角色随后在表格中分配
  async function add() {
    if (!addId.length) return;
    setAdding(true);
    try {
      for (const userId of addId) {
        await apiPost(`/api/projects/${projectId}/members`, {
          userId,
          role: "MEMBER",
        });
      }
      onRefresh();
      setAddId([]);
      setAddingDlg(false);
      toast.success(t("memberAddedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("addFailed"));
    } finally {
      setAdding(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    try {
      await apiPost(`/api/projects/${projectId}/members`, { userId, role });
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("roleUpdateFailed"));
    }
  }

  async function remove(m: ProjectMemberRow) {
    try {
      await apiDelete(`/api/projects/${projectId}/members?userId=${m.userId}`);
      onRefresh();
      setRemoving(null);
      toast.success(t("memberRemovedToast", { name: m.user.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("removeFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("membersSummary", { count: projectMembers?.length ?? 0 })}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setAddingDlg(true)}>
            <Plus className="size-4" />
            {t("addMember")}
          </Button>
        )}
      </div>

      <Dialog open={addingDlg} onOpenChange={(o) => !o && setAddingDlg(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("addMember")}</DialogTitle>
            <DialogDescription>
              {t("addMemberDesc")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="grid gap-1">
              <Label>{t("selectMembersLabel")}</Label>
              <MemberCombobox
                // 候选排除已在项目中的人：加人对话框的存在意义只剩"缺人可加"，
                // 列出已加入者只会诱导无效提交（服务端虽幂等，但误导面是产品缺陷）
                members={(members ?? []).filter(
                  (m) => !(projectMembers ?? []).some((p) => p.userId === m.user.id),
                )}
                selected={addId}
                onChange={setAddId}
                placeholder={t("selectMembersPlaceholder")}
                variant="staging"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAddingDlg(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={!addId.length || adding}>
                {t("add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TableShell>
        <Table className="w-full text-sm">
          <TableHeader className="text-xs text-muted-foreground">
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="px-4 py-2.5 font-medium">{t("colMember")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colRole")}</TableHead>
              {canManage && <TableHead className="px-4 py-2.5" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(projectMembers ?? []).length === 0 && (
              <TableEmptyRow colSpan={canManage ? 3 : 2}>
                {t("noProjectMembers")}
              </TableEmptyRow>
            )}
            {(projectMembers ?? []).map((m) => (
              <TableRow
                key={m.userId}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40"
              >
                <TableCell className="px-4 py-2.5">
                  <span className="block truncate">{m.user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {credentialHint(tLabels, m.user)}
                  </span>
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  {canManage ? (
                    <Select
                      value={m.role}
                      onValueChange={(role) => changeRole(m.userId, role)}
                    >
                      <SelectTrigger size="sm" className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROJECT_ROLE_LABEL).map(([v, labelKey]) => (
                          <SelectItem key={v} value={v}>
                            {t(labelKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t(PROJECT_ROLE_LABEL[m.role] ?? m.role)}
                    </span>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground/60 hover:text-destructive"
                      onClick={() => setRemoving(m)}
                      title={t("removeFromProject")}
                      aria-label={t("removeMemberAria", { name: m.user.name })}
                    >
                      {t("remove")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>

      <ConfirmDialog
        open={removing !== null}
        title={t("removeMemberTitle")}
        description={t("removeMemberDesc", { name: removing?.user.name ?? "" })}
        confirmLabel={t("remove")}
        destructive
        onConfirm={() => removing && remove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

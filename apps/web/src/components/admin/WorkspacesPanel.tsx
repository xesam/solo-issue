"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPatch, apiPost } from "@/lib/client/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";
import PageHeader from "@/components/shell/PageHeader";

import { Building2, Plus, Users } from "lucide-react";

// 工作区治理（U2.2）：列表 / 新建 / 重命名 / 成员管理。
// 成员管理与用户页「加入工作区」对等（同一张 WorkspaceMember 表、同一套角色与护栏）：用户表从
// 用户方向分配，工作区表从工作区方向配置（新工作区默认无人，两条路都可达）。

import MemberManageDialog from "@/components/admin/MemberManageDialog";

type Workspace = {
  id: string;
  slug: string;
  name: string;
  _count?: { members: number; projects: number };
};

export default function WorkspacesPanel() {
  const qc = useQueryClient();
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const [showWsCreate, setShowWsCreate] = useState(false);
  const [wsForm, setWsForm] = useState({ name: "", slug: "" });
  const [renamingWs, setRenamingWs] = useState<Workspace | null>(null);
  const [wsRenameText, setWsRenameText] = useState("");
  const [busy, setBusy] = useState(false);
  // 成员管理弹框的目标工作区（与用户页角色列对等的入口，Dialog 承载）
  const [managingWs, setManagingWs] = useState<Workspace | null>(null);

  const workspaces = useQuery({
    queryKey: ["admin-workspaces"],
    queryFn: () => apiGet<Workspace[]>("/api/admin/workspaces"),
  });

  // 同时失效两个缓存：新建/重命名改工作区列表；重命名还会改用户页角色列里的 wsName
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["admin-workspaces"] });
    await qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function act(fn: () => Promise<unknown>, okMsg?: string) {
    if (busy) return; // 新建/重命名共用：飞行中双击直接否决，防并行双发
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* 页头：分区标题 + 主操作（与用户页同构） */}
      <PageHeader title={t("workspaces")} className="px-8 py-6">
        {/* 新建工作区：Dialog 弹出框（UI 验收定案，弃内联展开；与用户页建号同模式） */}
        <Dialog open={showWsCreate} onOpenChange={setShowWsCreate}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Building2 className="size-3.5" />
              {t("newWorkspace")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("createWorkspaceTitle")}</DialogTitle>
              <DialogDescription>{t("createWorkspaceDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-1">
                <Label htmlFor="new-ws-name">{t("wsNameLabel")}</Label>
                <Input
                  id="new-ws-name"
                  value={wsForm.name}
                  onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })}
                  placeholder={t("wsNamePlaceholder")}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="new-ws-slug">{t("wsSlugLabel")}</Label>
                <Input
                  id="new-ws-slug"
                  value={wsForm.slug}
                  onChange={(e) => setWsForm({ ...wsForm, slug: e.target.value })}
                  placeholder={t("wsSlugPlaceholder")}
                  className="font-mono"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("wsSlugHint", { slug: wsForm.slug || "<slug>" })}
              </p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{tCommon("cancel")}</Button>
              </DialogClose>
              <Button
                disabled={busy || !wsForm.name.trim() || !wsForm.slug.trim()}
                onClick={() =>
                  act(async () => {
                    await apiPost("/api/admin/workspaces", wsForm);
                    setShowWsCreate(false);
                    setWsForm({ name: "", slug: "" });
                  }, t("createWsToast", { name: wsForm.name }))
                }
              >
                {t("createWorkspace")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="px-8 py-6">

      {/* 工作区列表：全站表格唯一配方（ui-guidelines §2），与用户页/项目列表同构 */}
      <TableShell>
        <Table className="w-full text-sm">
          <TableHeader className="text-xs text-muted-foreground">
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="px-4 py-2.5 font-medium">{t("colWorkspace")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colAddress")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colMembers")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colProjects")}</TableHead>
              <TableHead className="px-4 py-2.5" />
          </TableRow>
          </TableHeader>
          <TableBody>
            {workspaces.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={`sk-${i}`} className="border-b border-border/60">
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell className="px-4 py-3"><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell className="px-4 py-3"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                </TableRow>
              ))}
            {(workspaces.data ?? []).map((w) => (
              <TableRow key={w.id} className="border-b border-border/60 last:border-0">
                <TableCell className="max-w-md px-4 py-2.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Building2 className="size-3.5 text-muted-foreground/70" aria-hidden />
                    {w.name}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap px-4 py-2.5">
                  <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    /w/{w.slug}
                  </code>
                </TableCell>
                <TableCell className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{w._count?.members ?? "—"}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-1.5 text-xs text-muted-foreground"
                      onClick={() => setManagingWs(w)}
                    >
                      <Users className="size-3" aria-hidden />
                      {t("memberManagement")}
                    </Button>
                  </span>
                </TableCell>
                <TableCell className="px-4 py-2.5 text-xs text-muted-foreground">{w._count?.projects ?? "—"}</TableCell>
                <TableCell className="px-4 py-2.5 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => {
                      setRenamingWs(w);
                      setWsRenameText(w.name);
                    }}
                  >
                    {t("rename")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {workspaces.isError ? (
              <TableEmptyRow colSpan={5}>{t("wsLoadFailed")}</TableEmptyRow>
            ) : (
              !workspaces.isLoading &&
              (workspaces.data?.length ?? 0) === 0 && (
                <TableEmptyRow colSpan={5}>{t("noWorkspaces")}</TableEmptyRow>
              )
            )}
          </TableBody>
        </Table>
      </TableShell>
      </div>

      {/* 重命名：编辑交互一律 Dialog 承载（ui-guidelines），与新建工作区同模式 */}
      <Dialog open={!!renamingWs} onOpenChange={(o) => !o && setRenamingWs(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("renameWsTitle")}</DialogTitle>
            <DialogDescription>
              {t("renameWsDesc", { slug: renamingWs?.slug ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1">
              <Label htmlFor="rename-ws-name">{t("wsNameLabel")}</Label>
              <Input
                id="rename-ws-name"
                value={wsRenameText}
                onChange={(e) => setWsRenameText(e.target.value)}
                placeholder={t("wsNamePlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{tCommon("cancel")}</Button>
            </DialogClose>
            <Button
              disabled={busy || !wsRenameText.trim()}
              onClick={() =>
                renamingWs &&
                act(async () => {
                  await apiPatch(`/api/admin/workspaces/${renamingWs.id}`, { name: wsRenameText });
                  setRenamingWs(null);
                }, t("renamedToast"))
              }
            >
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 工作区方向的成员管理（ui-guidelines：编辑交互一律 Dialog 承载） */}
      <MemberManageDialog
        ws={managingWs}
        open={!!managingWs}
        onOpenChange={(o) => {
          if (!o) setManagingWs(null);
        }}
      />
    </div>
  );
}

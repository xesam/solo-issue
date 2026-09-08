"use client";

import { useMemo, useRef, useState } from "react";
import type { FieldType } from "@prisma/client";
import { toast } from "sonner";
import { Download, GripVertical, Plus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Translator } from "@/i18n/config";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useArchiveCustomField,
  useCreateCustomField,
  useCustomFields,
  useImportCustomFields,
  useUpdateCustomField,
  apiGet,
  apiPatch,
  useMutation,
  useQueryClient,
  type CustomFieldDTO,
  type CustomFieldOption,
  type CustomFieldSettings,
} from "@/lib/client/api";

// 项目设置 → 字段管理
// 语义（见 docs/06-api-contract.md）：key/type 不可变；选项与字段均软删；
// 归档字段的历史值保留、表单不再出现。

const TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "typeText",
  NUMBER: "typeNumber",
  DATE: "typeDate",
  SELECT: "typeSelect",
  USER: "typeUser",
};

/** 「多选」为 UI 展示形态（存储 = SELECT + settings.multiple），仅出现在新建下拉 */
const MULTI = "__MULTI__";
type DraftType = FieldType | typeof MULTI;

const CREATE_TYPE_OPTIONS: { value: DraftType; labelKey: string }[] = [
  { value: "TEXT", labelKey: "typeText" },
  { value: "NUMBER", labelKey: "typeNumber" },
  { value: "DATE", labelKey: "typeDate" },
  { value: "SELECT", labelKey: "typeSelect" },
  { value: MULTI, labelKey: "typeMultiSelect" },
  { value: "USER", labelKey: "typeUser" },
];

/** 表格「类型」列：multiple 的 SELECT 显示「多选」 */
function typeLabelOf(t: Translator, f: { type: FieldType; settings?: CustomFieldSettings | null }) {
  return f.type === "SELECT" && f.settings?.multiple === true ? t("typeMultiSelect") : t(TYPE_LABEL[f.type]);
}

// ── 拖拽排序（fractional indexing：中点插值）──
// sequence 为 Float 列：拖到新位置只写「被移动字段」一个 PATCH，
// 取前后邻居 sequence 的中点；间隔被二分耗尽（< MIN_GAP）时全量规整兜底。
// GAP 与服务端新建默认间隔一致（max + 1024，见 custom-field.ts）。
const GAP = 1024;
const MIN_GAP = 0.1;

/** 末尾追加落点（droppable 编号）：拖拽中渲染在末行之下，命中即追加到表尾 */
const END_ID = "__fields-end__";

/** 拖拽只允许竖直位移（横向归零）——等价 @dnd-kit/modifiers 的 restrictToVerticalAxis，
 *  内联实现避免为此新增依赖 */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** 落点上/下半区翻转的迟滞死区（px）：消灭拖到行附近时指示线因手部微颤来回跳变 */
const EDGE_DEAD_ZONE = 4;

/** 计算一次移动的 sequence 写入：常规 1 个 PATCH；间隔耗尽时规整为有序的全部字段 */
function planMove(list: CustomFieldDTO[], from: number, to: number) {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const prev = to > 0 ? next[to - 1].sequence : undefined;
  const after = to < next.length - 1 ? next[to + 1].sequence : undefined;
  let seq: number | null = null;
  if (prev === undefined && after === undefined) return [];
  else if (prev === undefined) seq = after! - GAP;
  else if (after === undefined) seq = prev + GAP;
  else if (after - prev >= MIN_GAP) seq = (prev + after) / 2;
  if (seq !== null) {
    if (seq === moved.sequence) return [];
    return [{ fieldId: moved.id, sequence: seq }];
  }
  // 间隔耗尽：按索引重排（1024 间隔），只写有变化的字段
  return next
    .map((f, i) => ({ fieldId: f.id, sequence: GAP * (i + 1) }))
    .filter((op, i) => op.sequence !== next[i].sequence);
}

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

type Draft = {
  key: string;
  name: string;
  type: DraftType;
  options: CustomFieldOption[];
  settings: CustomFieldSettings;
  isRequired: boolean;
};

const EMPTY: Draft = {
  key: "",
  name: "",
  type: "TEXT",
  options: [],
  settings: {},
  isRequired: false,
};

/** USER：值 = 工作区可见成员 userId（单选 string / 多选 string[]） */
const USER_MULTIPLE = (s: CustomFieldSettings) => s.multiple === true;

export default function CustomFieldsTab({
  projectId,
  canManage,
}: {
  projectId: string;
  // 字段定义是项目级元数据：管理归项目负责人（∨工作区 OWNER，fields:write 同口径）。
  // 与 StatesSection 同构——普通成员可读，不给"能点保存"的错觉
  canManage: boolean;
}) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const tIssues = useTranslations("issues");
  const fields = useCustomFields(projectId, true);
  const createField = useCreateCustomField(projectId);
  const updateField = useUpdateCustomField(projectId);
  const archiveField = useArchiveCustomField(projectId);
  const importFields = useImportCustomFields(projectId);

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<CustomFieldDTO | null>(null);
  const [editing, setEditing] = useState<CustomFieldDTO | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: "above" | "below" } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 拖拽位移（transform）= 指针相对抓手的增量，本身无边界——指针拖出表格外时行会跟着
  // 指针跑（拖到末行下方空白处即“无限往下”）。onDragStart 测一次表格容器边界，
  // modifier 内把 translateY 夹在容器范围内（draggingNodeRect = 未变换的行矩形）。
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const dragBoundsRef = useRef<{ top: number; bottom: number } | null>(null);
  const modifiers = useMemo<Modifier[]>(
    () => [
      verticalOnly,
      ({ draggingNodeRect, transform }) => {
        const b = dragBoundsRef.current;
        let y = transform.y;
        if (b && draggingNodeRect) {
          y = Math.min(
            Math.max(y, b.top - draggingNodeRect.top),
            b.bottom - draggingNodeRect.bottom,
          );
        }
        return { ...transform, y };
      },
    ],
    [],
  );

  const active = (fields.data ?? []).filter((f) => !f.isArchived);
  const archived = (fields.data ?? []).filter((f) => f.isArchived);

  // 拖拽排序落库：乐观更新（拖完即时生效），失败回滚并报错
  const moveFields = useMutation({
    mutationFn: (ops: { fieldId: string; sequence: number }[]) =>
      Promise.all(
        ops.map((op) =>
          apiPatch(`/api/projects/${projectId}/fields/${op.fieldId}`, { sequence: op.sequence }),
        ),
      ),
    onMutate: async (ops) => {
      const prev = qc.getQueriesData<CustomFieldDTO[]>({ queryKey: ["customFields", projectId] });
      prev.forEach(([key, data]) => {
        if (!Array.isArray(data)) return;
        const seq = new Map(ops.map((o) => [o.fieldId, o.sequence]));
        qc.setQueryData(
          key,
          data
            .map((f) => (seq.has(f.id) ? { ...f, sequence: seq.get(f.id)! } : f))
            .sort((a, b) => a.sequence - b.sequence || a.key.localeCompare(b.key)),
        );
      });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(e instanceof Error ? e.message : t("orderSaveFailed"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["customFields", projectId] }),
  });

  // 落点判定：拖动行中心落到目标行上/下半区 → 插到其上/下方
  // 落点判定逐帧走 onDragMove。注意：dnd-kit 的 onDragOver 只在 over「变化」时触发
  //（等价 HTML5 的 dragenter/leave），拖动行在同一目标行内继续微调指针时不会回调——
  // 依赖它缓存的 edge 会过时（真机定位过：拖到顶部/越过末行时落点冻结在过时方向）。
  // onDragEnd 里再按最终几何重算，指示线只作视觉参考。
  function onDragMove(e: DragMoveEvent) {
    if (!e.over || String(e.active.id) === String(e.over.id)) {
      setDropTarget(null);
      return;
    }
    const id = String(e.over.id);
    if (id === END_ID) {
      setDropTarget((p) => (p?.id === END_ID ? p : { id: END_ID, edge: "below" }));
      return;
    }
    const t = e.active.rect.current.translated;
    const center = t ? t.top + t.height / 2 : 0;
    const overCenter = e.over.rect.top + e.over.rect.height / 2;
    const edge = center >= overCenter ? "below" : "above";
    setDropTarget((prev) => {
      if (prev && prev.id === id && prev.edge === edge) return prev;
      // 同一行翻转 edge 要求越过死区（迟滞）：消灭 ±1-2px 微颤导致的指示线来回跳变
      if (
        prev &&
        prev.id === id &&
        prev.edge !== edge &&
        Math.abs(center - overCenter) <= EDGE_DEAD_ZONE
      ) {
        return prev;
      }
      return { id, edge };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    setDropTarget(null);
    setDraggingId(null);
    // 不使用缓存 dropTarget：结束时重算（防微调过时；over 不变时 onDragOver 不触发）
    if (!e.over || moveFields.isPending || !canManage) return;
    const from = active.findIndex((f) => f.id === String(e.active.id));
    if (from < 0) return;
    const over = e.over;
    let to: number;
    if (String(over.id) === END_ID) {
      to = active.length - 1;
    } else {
      const t = e.active.rect.current.translated;
      const center = t ? t.top + t.height / 2 : 0;
      const overCenter = over.rect.top + over.rect.height / 2;
      const edge = center >= overCenter ? "below" : "above";
      const overIdx = active.findIndex((f) => f.id === String(over.id));
      if (overIdx < 0) return;
      const insertion = edge === "below" ? overIdx + 1 : overIdx;
      to = insertion > from ? insertion - 1 : insertion;
    }
    if (to === from) return;
    moveFields.mutate(planMove(active, from, to));
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    if (!KEY_RE.test(draft.key)) return toast.error(t("keyRuleToast"));
    const isSelectLike = draft.type === "SELECT" || draft.type === MULTI;
    if (isSelectLike && draft.options.length === 0)
      return toast.error(t("optionsRequiredToast"));
    // 「多选」为展示形态：落库 = SELECT + settings.multiple
    const realType: FieldType = draft.type === MULTI ? "SELECT" : draft.type;
    try {
      await createField.mutateAsync({
        key: draft.key,
        name: draft.name.trim(),
        type: realType,
        options: isSelectLike ? draft.options : undefined,
        settings: buildSettings(
          realType,
          draft.type === MULTI ? { ...draft.settings, multiple: true } : draft.settings,
        ),
        isRequired: draft.isRequired,
      });
      setDraft(EMPTY);
      setCreating(false);
      toast.success(t("fieldCreatedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("createFailed"));
    }
  }

  async function doExport() {
    try {
      const data = await apiGet<{ version: number; fields: unknown[] }>(
        `/api/projects/${projectId}/fields/export`,
      );
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `custom-fields-${projectId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("exportFailed"));
    }
  }

  async function doImport() {
    let payload: unknown;
    try {
      payload = JSON.parse(importText);
    } catch {
      return toast.error(t("jsonParseFailed"));
    }
    const raw = (payload as { fields?: unknown }).fields;
    if (!Array.isArray(raw) || !raw.length) return toast.error(t("missingFieldsArray"));
    try {
      const res = await importFields.mutateAsync(raw as never);
      setShowImport(false);
      setImportText("");
      toast.success(
        t("importDoneToast", { created: res.created, updated: res.updated }) +
          (res.skipped.length ? t("importSkippedToast", { count: res.skipped.length }) : ""),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("importFailed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t("fieldsSummary", { count: active.length })}
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={doExport}>
            <Download className="size-3.5" /> {t("export")}
          </Button>
          {canManage && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 text-xs"
                onClick={() => setShowImport(true)}
              >
                <Upload className="size-3.5" /> {t("import")}
              </Button>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> {t("newField")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 字段列表：§9.2 表格三件套（多字段数据行拆列，操作列右对齐）；首列为拖拽排序手柄 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={modifiers}
        onDragStart={(e) => {
          setDraggingId(String(e.active.id));
          // 边界测量必须等追加占位行（zone）上屏后再做：同 tick 测量会漏掉 zone 高度，
          // 拖动行被夹在末行底缘、中心困在目标行中心 ±4px 死区内 edge 翻不过去——
          // 表现为末行下方无指示线（落点仍正确，纯视觉缺陷；真机踩过的坑）。
          // 双 rAF 跨帧测量，规避同帧未 paint 的脏布局。
          dragBoundsRef.current = null;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const r = tableWrapRef.current?.getBoundingClientRect();
              dragBoundsRef.current = r ? { top: r.top, bottom: r.bottom } : null;
            }),
          );
        }}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDropTarget(null);
          setDraggingId(null);
        }}
      >
      <TableShell ref={tableWrapRef}>
        <Table className="w-full text-sm">
          <TableHeader className="text-xs text-muted-foreground">
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-8 px-2 py-2.5" aria-label={t("dragSortAria")} />
              <TableHead className="px-4 py-2.5 font-medium">{t("colField")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colType")}</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">{t("colRequired")}</TableHead>
              <TableHead className="px-4 py-2.5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                canManage={canManage}
                edge={dropTarget?.id === f.id ? dropTarget.edge : null}
                onEdit={() => setEditing(f)}
                onToggleRequired={() =>
                  updateField
                    .mutateAsync({ fieldId: f.id, patch: { isRequired: !f.isRequired } })
                    .catch((e) => toast.error(e instanceof Error ? e.message : t("operationFailed")))
                }
                onArchive={() => setArchiving(f)}
              />
            ))}
            {/* 追加区指示线与其他行同观感：直接命中 END 区、或末行判定 edge=below
                （语义同为"追加到表尾"）都高亮，避免末行下半区拖拽时无视觉反馈 */}
            {draggingId && (
              <FieldListEndZone
                highlight={
                  !!dropTarget &&
                  (dropTarget.id === END_ID ||
                    (dropTarget.edge === "below" &&
                      dropTarget.id === active[active.length - 1]?.id))
                }
              />
            )}
            {!active.length && (
              <TableEmptyRow colSpan={5} className="py-10 text-xs">
                {t("noFields")}
              </TableEmptyRow>
            )}
          </TableBody>
        </Table>
      </TableShell>
      </DndContext>

      {archived.length > 0 && (
        <details className="rounded-xl border border-border p-4">
          <summary className="text-xs font-medium text-muted-foreground">
            {t("archivedFieldsSummary", { count: archived.length })}
          </summary>
          <div className="mt-2">
            <TableShell>
              <Table className="w-full text-xs">
                <TableHeader className="text-xs text-muted-foreground">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="px-4 py-2 font-medium">{t("colField")}</TableHead>
                    <TableHead className="px-4 py-2 font-medium">{t("colType")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archived.map((f) => (
                    <TableRow key={f.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <TableCell className="px-4 py-2 text-muted-foreground">
                        {f.name} <span className="font-mono opacity-60">{f.key}</span>
                      </TableCell>
                      <TableCell className="px-4 py-2 text-muted-foreground">{typeLabelOf(tIssues, f)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableShell>
          </div>
        </details>
      )}

      {/* 新建字段：§9.1 Dialog 承载（页头主按钮触发，禁止页内内联展开长表单） */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("newField")}</DialogTitle>
            <DialogDescription>
              {t("newFieldDesc")}
            </DialogDescription>
          </DialogHeader>
          <form
            id="new-field-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitNew(e);
            }}
          >
            {/* 基础定义：每行一项、Label 在上、控件同高 */}
            <div className="grid gap-1">
              <Label htmlFor="new-field-name">{t("displayName")}</Label>
              <Input
                id="new-field-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("fieldNamePlaceholder")}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="new-field-key">{t("keyLabel")}</Label>
              <Input
                id="new-field-key"
                value={draft.key}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                placeholder="severity"
                className="font-mono"
              />
            </div>
            <div className="grid gap-1">
              <Label>{t("typeLabel")}</Label>
              <Select
                value={draft.type}
                onValueChange={(v) => setDraft({ ...draft, type: v as DraftType })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREATE_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={String(o.value)} value={String(o.value)}>
                      {tIssues(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SwitchRow
              label={t("requiredSwitch")}
              checked={draft.isRequired}
              onChange={(v) => setDraft({ ...draft, isRequired: v })}
            />
            {(draft.type === "SELECT" || draft.type === MULTI) && (
              <OptionEditor
                options={draft.options}
                onChange={(options) => setDraft({ ...draft, options })}
              />
            )}

            {draft.type === "USER" && (
              <SwitchRow
                label={t("multipleSwitch")}
                hint={t("multipleUserHint")}
                checked={USER_MULTIPLE(draft.settings)}
                onChange={(v) =>
                  setDraft({ ...draft, settings: { ...draft.settings, multiple: v } })
                }
              />
            )}

            <NotifyRuleEditor
              type={draft.type === MULTI ? "SELECT" : draft.type}
              settings={draft.settings}
              onChange={(settings) => setDraft({ ...draft, settings })}
            />
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              form="new-field-form"
              disabled={!draft.name.trim() || !draft.key.trim() || createField.isPending}
            >
              {tCommon("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 归档确认：软删属破坏性操作，走 ConfirmDialog */}
      <ConfirmDialog
        open={archiving !== null}
        title={t("archiveFieldTitle")}
        description={t("archiveFieldDesc", { name: archiving?.name ?? "", key: archiving?.key ?? "" })}
        confirmLabel={t("archive")}
        destructive
        onConfirm={() => {
          const f = archiving;
          if (!f) return;
          setArchiving(null);
          archiveField
            .mutateAsync(f.id)
            .then(() => toast.success(t("archiveFieldDoneToast")))
            .catch((e) => toast.error(e instanceof Error ? e.message : t("archiveFailed")));
        }}
        onCancel={() => setArchiving(null)}
      />

      {editing && (
        <EditFieldDialog
          field={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            try {
              await updateField.mutateAsync({ fieldId: editing.id, patch });
              setEditing(null);
              toast.success(t("fieldUpdatedToast"));
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("updateFailed"));
            }
          }}
        />
      )}

      <Dialog open={showImport} onOpenChange={(o) => !o && setShowImport(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("importTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {t("importDescHead")}{"{ version, fields: [...] }"}{t("importDescTail")}
          </p>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={10}
            placeholder='{"version":1,"fields":[…]'
            className="font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowImport(false)}>
              {tCommon("cancel")}
            </Button>
            <Button size="sm" onClick={doImport} disabled={!importText.trim() || importFields.isPending}>
              {t("import")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 类型专属配置 + 字段级通知规则 ──

/** 只保留当前类型相关的 settings，避免脏配置（如 TEXT 带上 multiple） */
function buildSettings(type: FieldType, s: CustomFieldSettings): CustomFieldSettings | undefined {
  const out: CustomFieldSettings = {};
  if (type === "USER") out.multiple = s.multiple === true;
  else if (type === "SELECT") {
    // SELECT 多选开关存 settings.multiple（与 USER 同约定）；单选不落 false，保持 settings 干净
    if (s.multiple === true) out.multiple = true;
  }
  const rule = s.notifyOn;
  if (rule?.values.length && rule.notify.length) out.notifyOn = rule;
  return Object.keys(out).length ? out : undefined;
}

const NOTIFY_TARGET_LABEL: Record<string, string> = {
  PROJECT_LEAD: "notifyTargetProjectLead",
  FIELD_USERS: "notifyTargetFieldUsers",
};

/** 独立开关行（弹框内无边框纯行式；页面级卡片行见「私有项目」开关） */
function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="min-w-0">
        <Label>{label}</Label>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** 字段值变为指定值时触发通知（afterWrite 规则；留空即不通知） */
function NotifyRuleEditor({
  type,
  settings,
  onChange,
}: {
  type: FieldType;
  settings: CustomFieldSettings;
  onChange: (s: CustomFieldSettings) => void;
}) {
  const t = useTranslations("project");
  const rule = settings.notifyOn;
  const [valuesText, setValuesText] = useState((rule?.values ?? []).join(", "));

  const supported = type === "SELECT" || type === "TEXT" || type === "USER";
  if (!supported) return null;

  function commit(text: string) {
    setValuesText(text);
    const values = text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (!values.length) {
      onChange({ ...settings, notifyOn: undefined });
      return;
    }
    onChange({
      ...settings,
      notifyOn: { values, notify: rule?.notify?.length ? rule.notify : ["PROJECT_LEAD"] },
    });
  }

  function toggleTarget(target: "PROJECT_LEAD" | "FIELD_USERS") {
    const cur = rule?.notify ?? [];
    const next = cur.includes(target) ? cur.filter((t) => t !== target) : [...cur, target];
    if (!next.length) return;
    onChange({ ...settings, notifyOn: { values: rule?.values ?? [], notify: next } });
  }

  return (
    <div className="grid gap-1">
      <Label>{t("notifyRuleLabel")}</Label>
      <p className="text-xs text-muted-foreground">
        {type === "USER" ? t("notifyRuleHintUser") : t("notifyRuleHint")}
      </p>
      <Input
        value={valuesText}
        onChange={(e) => commit(e.target.value)}
        placeholder={type === "USER" ? "userId1, userId2" : "critical, blocker"}
        className="font-mono"
      />
      {rule?.values.length ? (
        <div className="flex flex-wrap gap-4 pt-1">
          {(["PROJECT_LEAD", "FIELD_USERS"] as const).map((target) => (
            <label key={target} className="flex items-center gap-2 text-sm">
              <Switch
                checked={rule.notify.includes(target)}
                onCheckedChange={() => toggleTarget(target)}
              />
              {t(NOTIFY_TARGET_LABEL[target])}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 末尾追加落点：拖拽中渲染在末行之下的占位行；命中或末行 edge=below 时
 * 亮起与其他行一致的 inset 指示线（语义同为"追加到表尾"） */
function FieldListEndZone({ highlight }: { highlight: boolean }) {
  const t = useTranslations("project");
  const { setNodeRef, isOver } = useDroppable({ id: END_ID });
  const on = highlight || isOver;
  return (
    <tr
      ref={setNodeRef}
      className="bg-muted/20"
      aria-label={t("appendToEnd")}
      style={on ? { boxShadow: "inset 0 2px 0 0 var(--primary)" } : undefined}
    >
      <td colSpan={5} className="h-5 px-4 py-1" />
    </tr>
  );
}

function FieldRow({
  field,
  canManage,
  edge,
  onEdit,
  onToggleRequired,
  onArchive,
}: {
  field: CustomFieldDTO;
  // 只读态：拖拽手柄/必填开关/操作列全部关闸（与服务端 requireProjectAdmin 同口径）
  canManage: boolean;
  /** 拖拽落点指示：拖动行中心越过本行上/下半区时显示插入线 */
  edge: "above" | "below" | null;
  onEdit: () => void;
  onToggleRequired: () => void;
  onArchive: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } =
    useDraggable({ id: field.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: field.id });
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const tIssues = useTranslations("issues");
  const optionSummary =
    field.type === "SELECT"
      ? t("optionCount", { count: (field.options ?? []).filter((o) => !o.archived).length })
      : "";
  return (
    <TableRow
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`border-b border-border/60 last:border-0 hover:bg-muted/40 ${
        // 拖动中 transform 每帧更新，不套 transition（dnd-kit 经典坑，见 IssueBoard）
        isDragging ? "relative z-10 bg-card opacity-80" : ""
      }`}
      style={{
        // 拖拽经 verticalOnly modifier 锁定竖直轴，这里只做 Y 位移
        ...(transform ? { transform: `translateY(${transform.y}px)` } : {}),
        ...(edge
          ? { boxShadow: edge === "above" ? "inset 0 2px 0 0 var(--primary)" : "inset 0 -2px 0 0 var(--primary)" }
          : {}),
      }}
    >
      <TableCell className="w-8 px-2 py-2.5">
        {canManage && (
          <button
            type="button"
            aria-label={t("dragFieldAria", { name: field.name })}
            className="flex cursor-grab items-center text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}
      </TableCell>
      <TableCell className="px-4 py-2.5">
        <span className="block truncate">{field.name}</span>
        <span className="block truncate font-mono text-xs text-muted-foreground">{field.key}</span>
      </TableCell>
      <TableCell className="px-4 py-2.5 text-xs text-muted-foreground">
        {typeLabelOf(tIssues, field)}
        {optionSummary ? ` · ${optionSummary}` : ""}
      </TableCell>
      <TableCell className="px-4 py-2.5">
        <Switch checked={field.isRequired} disabled={!canManage} onCheckedChange={onToggleRequired} />
      </TableCell>
      <TableCell className="px-4 py-2.5 text-right">
        {canManage && (
          <>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onEdit}>
              {tCommon("edit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-1 h-7 px-2 text-xs text-muted-foreground/60 hover:text-destructive"
              onClick={onArchive}
              title={t("archiveOptionTitle")}
              aria-label={t("archiveFieldAria", { name: field.name })}
            >
              {t("archive")}
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

function OptionEditor({
  options,
  onChange,
}: {
  options: CustomFieldOption[];
  onChange: (options: CustomFieldOption[]) => void;
}) {
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const labelRef = useRef<HTMLInputElement>(null);

  /** 置灰条件与原因文案同源（§6.1 双闸：禁用须可见理由） */
  const dup = !!value.trim() && options.some((o) => o.value === value.trim());
  const reason = dup
    ? t("dupValueReason", { value: value.trim() })
    : !label.trim()
      ? t("enterLabelReason")
      : !value.trim()
        ? t("enterValueReason")
        : null;

  function tryAdd() {
    if (reason) return;
    onChange([...options, { value: value.trim(), label: label.trim() }]);
    setValue("");
    setLabel("");
    // 焦点回环：连续录入无需重找输入框
    labelRef.current?.focus();
  }

  return (
    <div className="grid gap-1">
      <Label>{t("optionsLabel")}</Label>
      <p className="text-xs text-muted-foreground">{t("optionsHint")}</p>
      {/* §9.4b 弹框内去壳表格：不套三件套外壳，表头无底色，行配方与页面级表格一致 */}
      <Table className="w-full text-sm">
        <TableHeader className="text-xs text-muted-foreground">
          <TableRow>
            <TableHead className="px-3 py-2 font-medium">{t("displayName")}</TableHead>
            <TableHead className="px-3 py-2 font-medium">value</TableHead>
            <TableHead className="px-3 py-2 text-right">{tCommon("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {options.map((o, i) => (
            <TableRow
              key={o.value}
              className="border-b border-border/60 last:border-0 hover:bg-muted/40"
            >
              <TableCell className="px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: o.color ?? "#94a3b8" }}
                  />
                  <span className="truncate">{o.label}</span>
                </span>
              </TableCell>
              <TableCell className="px-3 py-2">
                <span className="font-mono text-xs text-muted-foreground">{o.value}</span>
              </TableCell>
              <TableCell className="px-3 py-2 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-muted-foreground/60 hover:text-destructive"
                  aria-label={t("removeOptionAria", { label: o.label })}
                  onClick={() => onChange(options.filter((_, j) => j !== i))}
                >
                  {t("remove")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!options.length && (
            <TableEmptyRow colSpan={3} className="px-3 py-4 text-xs">
              {t("noOptions")}
            </TableEmptyRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-end gap-2 pt-1">
        <div className="grid flex-1 gap-1">
          <Label htmlFor={`option-label-${options.length}`} className="sr-only">
            {t("optionLabelSr")}
          </Label>
          <Input
            ref={labelRef}
            id={`option-label-${options.length}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("optionLabelPlaceholder")}
            // Enter 在两个输入框内一律拦截为「添加选项」（可用时），不得触发外层表单提交
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              tryAdd();
            }}
          />
        </div>
        <div className="grid w-36 gap-1">
          <Label htmlFor={`option-value-${options.length}`} className="sr-only">
            {t("optionValueSr")}
          </Label>
          <Input
            id={`option-value-${options.length}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("optionValuePlaceholder")}
            className="font-mono"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              tryAdd();
            }}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={reason !== null}
          onClick={tryAdd}
        >
          {t("add")}
        </Button>
      </div>
      {/* 禁用理由可见（§6.1）：已有录入意图（任一框非空）即提示——重复 value / 缺 value / 缺显示名 */}
      {reason && (value.trim() !== "" || label.trim() !== "") && (
        <p className="text-xs text-warning-text">{reason}</p>
      )}
    </div>
  );
}

function EditFieldDialog({
  field,
  onClose,
  onSave,
}: {
  field: CustomFieldDTO;
  onClose: () => void;
  onSave: (patch: {
    name?: string;
    isRequired?: boolean;
    options?: CustomFieldOption[];
    settings?: CustomFieldSettings;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(field.name);
  const [isRequired, setIsRequired] = useState(field.isRequired);
  const [options, setOptions] = useState<CustomFieldOption[]>(field.options ?? []);
  const [settings, setSettings] = useState<CustomFieldSettings>(field.settings ?? {});
  const [busy, setBusy] = useState(false);
  const t = useTranslations("project");
  const tCommon = useTranslations("common");

  const removed = (field.options ?? []).filter(
    (o) => !options.some((n) => n.value === o.value),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("editFieldTitle")} <span className="font-mono text-sm text-muted-foreground">{field.key}</span>
          </DialogTitle>
          <DialogDescription>
            {t("editFieldDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1">
            <Label htmlFor={`edit-field-name-${field.id}`}>{t("displayName")}</Label>
            <Input
              id={`edit-field-name-${field.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <SwitchRow
            label={t("requiredSwitch")}
            checked={isRequired}
            onChange={setIsRequired}
          />

          {/* 多选开关单向：仅允许 单→多（多→单会令存量数组值无法保存，服务端同步兜底） */}
          {field.type === "USER" && (
            <SwitchRow
              label={t("multipleSwitch")}
              hint={
                USER_MULTIPLE(field.settings ?? {})
                  ? t("multiEnabledHint")
                  : t("multipleUserHint")
              }
              checked={USER_MULTIPLE(settings)}
              disabled={USER_MULTIPLE(field.settings ?? {})}
              onChange={(v) => setSettings({ ...settings, multiple: v })}
            />
          )}

          {field.type === "SELECT" && (
            <SwitchRow
              label={t("multipleSwitch")}
              hint={
                (field.settings ?? {}).multiple === true
                  ? t("multiEnabledHint")
                  : t("multipleSelectHint")
              }
              checked={settings.multiple === true}
              disabled={(field.settings ?? {}).multiple === true}
              onChange={(v) => setSettings({ ...settings, multiple: v })}
            />
          )}

          <NotifyRuleEditor type={field.type} settings={settings} onChange={setSettings} />

          {field.type === "SELECT" && (
            <>
              <OptionEditor options={options} onChange={setOptions} />
              {removed.length > 0 && (
                <p className="text-xs text-warning-text">
                  {t("removedOptionsHead")}
                  {removed.map((o) => o.label).join("、")}
                </p>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  name: name.trim(),
                  isRequired,
                  ...(field.type === "SELECT" ? { options } : {}),
                  settings: buildSettings(field.type, settings),
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

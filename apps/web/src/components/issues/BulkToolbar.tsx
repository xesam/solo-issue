"use client";

import type { State } from "@prisma/client";
import type { MemberDTO } from "@/lib/client/api";
import { useBatchUpdate } from "@/lib/client/api";
import { useTranslations } from "next-intl";
import MemberCombobox from "@/components/members/MemberCombobox";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Archive, X } from "lucide-react";

// U3.1：批量工具条（选中 > 0 时出现在过滤器下方）。
// 状态/指派 → 即选即应用；归档为按钮（恢复走单条操作）；取消选择 X。
// 逐项调用 batch API（服务端逐条复用 updateIssue——Activity/通知/护栏同构）。
// 已知简化：指派器只能"所选条目统一指派给一人"——批量改指派为多元集合
// 或批量清空指派走单条编辑（`ids.length` 短路是刻意的，避免误触清空）。

export default function BulkToolbar({
  projectId,
  numbers,
  states,
  members,
  onDone,
  onClear,
}: {
  projectId: string;
  numbers: number[];
  states: State[] | undefined;
  members: MemberDTO[] | undefined;
  onDone: () => void; // 操作完成后清空选择
  onClear: () => void;
}) {
  const batch = useBatchUpdate(projectId);
  const t = useTranslations("issues");
  // 服务端 batchUpdateIssueSchema 上限 100 条/次；跨页勾选可能超——超限时禁用并提示分批
  const overLimit = numbers.length > 100;
  const busy = batch.isPending;

  async function apply(patch: Record<string, unknown>, okKey: string) {
    if (busy) return; // 与归档按钮同闸：批量进行中不再发起第二批（并发落库后写覆盖前写）
    let res;
    try {
      res = await batch.mutateAsync({ numbers, patch });
    } catch (err) {
      // 403/422/网络失败都要给反馈，否则用户"点了没反应"
      toast.error(err instanceof Error ? err.message : t("bulkFailed"));
      return;
    }
    if (res.updated.length)
      toast.success(t(okKey, { count: res.updated.length }));
    res.failed.forEach((f) =>
      toast.error(t("batchItemFailed", { number: f.number, reason: f.reason }), {
        duration: 6000,
      }),
    );
    onDone();
  }

  return (
    <div
      role="toolbar"
      aria-label={t("bulkActions")}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2"
    >
      <span className="text-xs font-medium text-primary">
        {t("selectedCount", { count: numbers.length })}
      </span>
      {overLimit && (
        <span className="text-xs text-warning-text">
          {t("bulkLimitHint")}
        </span>
      )}

      <Select onValueChange={(v) => v && apply({ stateId: v }, "stateChangedBulk")}>
        <SelectTrigger size="sm" className="w-28 text-xs" disabled={busy || overLimit}>
          {t("changeState")}
        </SelectTrigger>
        <SelectContent>
          {states?.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="w-44">
        <MemberCombobox
          members={members}
          selected={[]}
          disabled={busy || overLimit}
          onChange={(ids) => ids.length && !busy && !overLimit && apply({ assigneeIds: ids }, "assignedBulk")}
          placeholder={t("assignTo")}
        />
      </div>

      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={busy || overLimit}
        onClick={() => apply({ isArchived: true }, "archivedBulk")}
      >
        <Archive className="size-3.5" />
        {t("archive")}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-7 text-xs"
        onClick={onClear}
      >
        <X className="size-3" />
        {t("clearSelection")}
      </Button>
    </div>
  );
}

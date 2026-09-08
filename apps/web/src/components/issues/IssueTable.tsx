"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { IssueDTO } from "@/lib/dto";
import type { IssueOrderField } from "@/lib/validations";
import {
  Avatar,
  StateBadge,
  fmtDateTime,
} from "@/components/ui/bits";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableShell } from "@/components/ui/table-shell";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomFieldDTO } from "@/lib/client/api";
import { useMembers } from "@/lib/client/api";
import { fieldOptionColor, formatFieldValue } from "@/components/issues/custom-field-display";

// U1.4：可排序表头（排序状态存 URL，刷新/分享/后退不丢）
function SortHead({
  label,
  field,
  orderBy,
  orderDir,
  onSort,
  className,
}: {
  label: string;
  field: IssueOrderField;
  orderBy?: IssueOrderField;
  orderDir?: "asc" | "desc";
  onSort: (field: IssueOrderField) => void;
  className?: string;
}) {
  const t = useTranslations("issues");
  const active = orderBy === field;
  const Icon = !active ? ArrowUpDown : orderDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={t("sortBy", { field: label })}
        className={cn(
          "inline-flex items-center gap-1 text-inherit transition-colors hover:text-foreground",
          active && "text-foreground",
          !active && "text-muted-foreground/70",
        )}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </TableHead>
  );
}

export default function IssueTable({
  issues,
  wsSlug,
  projectSlug,
  orderBy,
  orderDir,
  onSort,
  canWrite,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  customFields = [],
}: {
  issues: IssueDTO[];
  wsSlug: string;
  projectSlug: string;
  orderBy?: IssueOrderField;
  orderDir?: "asc" | "desc";
  onSort: (field: IssueOrderField) => void;
  canWrite: boolean;
  selected: Set<number>;
  onToggleSelect: (n: number) => void;
  onToggleSelectAll: () => void;
  // 已勾选展示的自定义字段列（纯展示，不参与排序）
  customFields?: CustomFieldDTO[];
}) {
  const t = useTranslations("issues");
  const base = `/w/${wsSlug}/p/${projectSlug}/issues`;
  // USER 自定义字段列的姓名解析（成员名单与指派人列同源；查不到回退 id 截断）
  const members = useMembers(wsSlug);
  const nameById = new Map((members.data ?? []).map((m) => [m.user.id, m.user.name]));
  const resolveUserName = (id: string) => nameById.get(id);
  // 分页后列表只含当前页——半选态按“本页已选数”计，跨页勾选不在表头表现（工具条已显总数）
  const pageSelected = issues.filter((i) => selected.has(i.number)).length;
  const allSelected = issues.length > 0 && pageSelected === issues.length;
  return (
    <TableShell>
      {/* min-w-max 让表按内容撑开自然宽度，字段列多时外层 overflow-x-auto 水平滑动 */}
      <Table className="min-w-max">
        <TableHeader className="text-xs text-muted-foreground">
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            {canWrite && (
              <TableHead className="w-10 px-3 py-2.5">
                <Checkbox
                  aria-label={t("selectAllPage")}
                  checked={allSelected ? true : pageSelected > 0 ? "indeterminate" : false}
                  onCheckedChange={onToggleSelectAll}
                />
              </TableHead>
            )}
            <TableHead className="px-4 py-2.5">{t("number")}</TableHead>
            <TableHead className="px-4 py-2.5">{t("title")}</TableHead>
            <TableHead className="px-4 py-2.5">{t("state")}</TableHead>
            <TableHead className="px-4 py-2.5">{t("assignees")}</TableHead>
            <TableHead className="px-4 py-2.5">{t("creator")}</TableHead>
            <SortHead label={t("createdAt")} field="createdAt" orderBy={orderBy} orderDir={orderDir} onSort={onSort} className="px-4 py-2.5" />
            <SortHead label={t("updatedAt")} field="updatedAt" orderBy={orderBy} orderDir={orderDir} onSort={onSort} className="px-4 py-2.5" />
            {customFields.map((f) => (
              <TableHead key={f.id} className="whitespace-nowrap px-4 py-2.5 text-muted-foreground/70">
                {f.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => (
            <TableRow
              key={issue.id}
              className={cn(
                "border-b border-border/60 last:border-0 hover:bg-muted/40",
                selected.has(issue.number) && "bg-muted/50",
              )}
            >
              {canWrite && (
                <TableCell className="px-3 py-2.5">
                  <Checkbox
                    aria-label={t("selectIssue", { number: issue.number })}
                    checked={selected.has(issue.number)}
                    onCheckedChange={() => onToggleSelect(issue.number)}
                  />
                </TableCell>
              )}
              <TableCell className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground/70">
                <Link href={`${base}/${issue.number}`} className="hover:text-primary">
                  #{issue.number}
                </Link>
              </TableCell>
              <TableCell className="max-w-md px-4 py-2.5">
                <Link
                  href={`${base}/${issue.number}`}
                  className="block truncate font-medium hover:text-primary"
                >
                  {issue.isArchived && (
                    <Badge variant="secondary" className="mr-1.5 px-1.5 text-xs font-normal text-muted-foreground">
                      {t("archived")}
                    </Badge>
                  )}
                  {issue.title}
                </Link>
              </TableCell>
              <TableCell className="px-4 py-2.5">
                <StateBadge state={issue.state} />
              </TableCell>
              <TableCell className="px-4 py-2.5">
                <div className="flex -space-x-1.5">
                  {issue.assignees.length ? (
                    issue.assignees.map((a) => (
                      <Avatar key={a.user.id} user={a.user} />
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground/50">{t("unassignedLabel")}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Avatar user={issue.creator} />
                  <span className="truncate text-xs text-muted-foreground/70">{issue.creator.name}</span>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground/70">
                {fmtDateTime(issue.createdAt)}
              </TableCell>
              <TableCell className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground/70">
                {fmtDateTime(issue.updatedAt)}
              </TableCell>
              {customFields.map((f) => {
                const raw = (issue.fieldValues as Record<string, unknown> | null)?.[f.key];
                // USER 列用成员姓名而非 userId 截断——members 本就拉了，只是从没接进来
                const text = formatFieldValue(f, raw, resolveUserName);
                const color = f.type === "SELECT" ? fieldOptionColor(f, raw) : undefined;
                return (
                  <TableCell key={f.id} className="max-w-40 px-4 py-2.5">
                    {text === null ? (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    ) : color ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                        title={text}
                      >
                        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <span className="truncate">{text}</span>
                      </span>
                    ) : (
                      <span className="block truncate text-sm" title={text}>
                        {text}
                      </span>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableShell>
  );
}

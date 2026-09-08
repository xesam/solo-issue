"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { TableCell, TableRow } from "@/components/ui/table";

// 全站表格唯一配方（ui-guidelines §9）：壳类名只在组件层出现一次，
// 调用方不再粘贴——「用了别的写法=代码不存在那条路径」。
// 壳 + TableEmptyRow 两件套，组合式：
//   <TableShell><Table>…</Table></TableShell>
//   <TableEmptyRow colSpan={5}>暂无工作区</TableEmptyRow>（放 TableBody 内）
// loading 骨架列宽因表而异，不收编（调用方自带）。

export const TableShell = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function TableShell({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("overflow-x-auto rounded-xl border border-border bg-card shadow-sm", className)}
        {...props}
      />
    );
  },
);

export function TableEmptyRow({
  colSpan,
  className,
  children,
}: {
  colSpan: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className={cn("px-4 py-8 text-center text-sm text-muted-foreground", className)}
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

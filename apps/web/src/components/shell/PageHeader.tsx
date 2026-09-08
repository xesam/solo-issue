import { cn } from "@/lib/utils";

// 页头行单源（ui-guidelines §9.1）：h1 单值字号 xl + 右端主操作，
// 禁止副文案/图标/分割线。不含页面容器 padding（px-8 py-6 由调用方节奏自持）。
// titleExtra：紧贴标题的左侧复合位点（如项目名旁的项目设置钮，不得挪行尾）；
// children = 右端主操作（Dialog 触发钮等）。
// className 覆盖行级差异（items-end / px-8 py-6 / mb-6），tailwind-merge 合并。

export default function PageHeader({
  title,
  titleClassName,
  titleExtra,
  className,
  children,
}: {
  title: React.ReactNode;
  /** 标题额外变体（如 truncate 防溢出） */
  titleClassName?: string;
  /** 紧贴标题右侧的复合位点（ProjectView 项目设置钮） */
  titleExtra?: React.ReactNode;
  /** 行级覆盖（对齐/间距/区隔留白） */
  className?: string;
  /** 右端主操作位点 */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-1">
        <h1 className={cn("text-xl font-semibold tracking-tight", titleClassName)}>{title}</h1>
        {titleExtra}
      </div>
      {children}
    </div>
  );
}

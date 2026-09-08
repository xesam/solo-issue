"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

// 问题页面骨架（创建/编辑统一外壳）：
// 面包屑 + 双栏布局（主栏 IssueForm + 右栏时间线）。两页共用同一骨架，
// 差异仅在各插槽内容：crumb 文案（"新建问题" vs "DEMO-N"）、右栏（空态预告
// vs 真实时间线+评论输入）。
//
// 右栏宽度/滚动约束只在此定义一次；lg（1024px）起双栏，以下随文档流堆叠。

export default function IssueShell({
  backHref,
  projectName,
  crumb,
  onBackClick,
  main,
  aside,
}: {
  backHref: string;
  projectName: string;
  /** 面包屑末段：创建页 "新建问题"；编辑页 "DEMO-12" */
  crumb: string;
  /** 编辑页：dirty 时点面包屑需要拦截确认 */
  onBackClick?: (e: React.MouseEvent) => void;
  /** 主栏内容（IssueForm） */
  main: React.ReactNode;
  /** 右栏内容：时间线（创建页为空态预告） */
  aside: React.ReactNode;
}) {
  const t = useTranslations("issues");
  return (
    <div className="px-8 py-6">
      {/* 面包屑：行首显式返回按钮 */}
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t("backTo", { name: projectName })}
          title={t("backTo", { name: projectName })}
        >
          <Link href={backHref} onClick={onBackClick}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <Link href={backHref} onClick={onBackClick} className="hover:text-primary">
          {projectName}
        </Link>
        <span className="mx-1.5 text-muted-foreground/40">/</span>
        <span className="font-mono text-muted-foreground/70">{crumb}</span>
      </div>

      {/* 主栏 = 表单（flex-1 流动）；右栏 = 对话面板（lg 起独立滚动） */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">{main}</div>
        {/* sticky 相对 main 滚动视口：可用高 = 100dvh − 顶栏 3rem − sticky 顶距 0.5rem，
	    按 100vh 算会高出 40px。flex 列布局：时间线内滚（见 aside 插槽 ol 的
	    flex-1 overflow），评论框作固定页脚——不遮时间线内容 */}
        <aside className="flex w-full shrink-0 flex-col lg:sticky lg:top-2 lg:max-h-[calc(100dvh-3.5rem)] lg:w-80">
          {aside}
        </aside>
      </div>
    </div>
  );
}

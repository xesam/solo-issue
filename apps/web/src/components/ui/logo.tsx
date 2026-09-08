import { useId } from "react";

import { cn } from "@/lib/utils";
import { FULL_VIEWBOX, ISSUE_PATH, MARK_PATH, SOLO_PATH } from "./logo-paths";

// 品牌渐变（图标专用固定色，不随主题切换）；id 走 useId，同页多实例互不串色
function MarkGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="138" y1="495" x2="347" y2="698" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#2C93FE" />
      <stop offset="1" stopColor="#0040D0" />
    </linearGradient>
  );
}

// 完整品牌 logo（图形 + 矢量字标），源自 docs/P00-project/logo.svg。
// "Solo" 取前景色以适配深色主题，"Issue" 保持品牌蓝；高度由调用方 className 控制，宽度按比例。
export function LogoFull({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox={FULL_VIEWBOX} aria-hidden className={cn("w-auto shrink-0", className)}>
      <defs>
        <MarkGradient id={gradientId} />
      </defs>
      <path fill={`url(#${gradientId})`} fillRule="evenodd" d={MARK_PATH} />
      <path className="fill-foreground" fillRule="evenodd" d={SOLO_PATH} />
      <path fill="#1E75FC" fillRule="evenodd" d={ISSUE_PATH} />
    </svg>
  );
}

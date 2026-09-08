"use client";

import { Toaster as Sonner } from "sonner";

// U1.3：全局 toast（sonner）。约定：
//  - 变更成功 → toast.success；系统/网络错误 → toast.error；表单校验错误保持表单内联展示
//  - 位置 top-center：避开右侧通知铃铛与底部状态条
// 主题：当前跟随浅色令牌；U2.6 引入 next-themes 后在此处接入主题联动
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "font-sans text-sm",
        },
      }}
    />
  );
}

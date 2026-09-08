"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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

/**
 * 站内确认对话框：替代 window.confirm / window.prompt，
 * 与全站 Radix Dialog 视觉一致，且不会被浏览器抑制/冻结页面。
 *
 * - destructive：确认按钮红色（删除/放弃修改等不可逆操作）
 * - requireInput：输入匹配 inputMatch 才能确认（强确认，如“输入编号 6”）
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  requireInput,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** 传则启用输入校验：输入与该值完全一致才允许确认 */
  requireInput?: { hint: string; match: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tCommon = useTranslations("common");
  const [typed, setTyped] = useState("");
  const confirmText = confirmLabel ?? tCommon("confirm");
  const cancelText = cancelLabel ?? tCommon("cancel");

  // 每次打开重置输入，避免上次残留直接解锁强确认
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const inputOk = !requireInput || typed === requireInput.match;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription className="whitespace-pre-line">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {requireInput ? (
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={requireInput.hint}
            aria-label={requireInput.hint}
            autoFocus
          />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!inputOk}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

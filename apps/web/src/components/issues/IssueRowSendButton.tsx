"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { withBase } from "@/lib/base-path";

// 列表行「发送」：点击弹预览框展示待复制的项目/ref/摘要/状态/绝对深链文本，可审查可修改
// （改动仅影响本次复制内容，不落库），确认后由框内「复制」按钮写入剪贴板并 toast 引导粘贴到聊天/邮件。
// 接收者点链接直达 issue（权限模型内：成员直达、未登录者登录后二次点击）。
// 直复制实测不直观：文本先过目再发出更可控；产品概念统一叫「发送」，图标用 Send 贴合动作意图。
// URL 取运行时 origin + withBase 拼绝对地址——不依赖 APP_URL 配置，反向代理域名也正确。
// 复制失败（非 HTTPS / 权限拒绝）不关弹窗，文本可见可选中，天然支持手动复制兜底。
export default function IssueRowSendButton({
  number,
  summary,
  stateName,
  projectName,
  wsSlug,
  projectSlug,
  className,
}: {
  number: number;
  summary: string;
  stateName: string;
  projectName: string;
  wsSlug: string;
  projectSlug: string;
  className?: string;
}) {
  const t = useTranslations("issues");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  function buildSendText() {
    const url = `${window.location.origin}${withBase(`/w/${wsSlug}/p/${projectSlug}/issues/${number}`)}`;
    return t("sendText", { project: projectName, number, summary, state: stateName, url });
  }

  function onOpenChange(v: boolean) {
    // 每次打开重置为模板原文（上次的手改不残留）；关闭走 ESC/遮罩/X/按钮的所有路径
    if (v) setText(buildSendText());
    setOpen(v);
  }

  async function copySendText() {
    try {
      await navigator.clipboard.writeText(text);
      setOpen(false);
      toast.success(t("copiedSendHint"));
    } catch {
      // 非 HTTPS / 剪贴板权限拒绝都走这里（CreateTokenDialog 同模式）——失败不关弹窗，用户可手动选中复制
      toast.error(t("copyFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={className}
        onClick={() => onOpenChange(true)}
        aria-label={t("sendIssue")}
        title={t("sendIssue")}
      >
        <Send className="size-3.5" />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sendIssue")}</DialogTitle>
          <DialogDescription>{t("sendPreviewDesc")}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t("sendTextLabel")}
          className="min-h-32"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button size="sm" disabled={!text.trim()} onClick={() => void copySendText()}>
            {t("copy")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

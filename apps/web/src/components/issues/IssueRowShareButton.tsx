"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withBase } from "@/lib/base-path";

// 列表行「分享」：一键把项目/ref/标题/状态/绝对深链写入剪贴板，并 toast 引导粘贴到聊天/邮件，
// 接收者点链接直达 issue（权限模型内：成员直达、未登录者登录后二次点击）。
// 图标用 Share2 而非 Copy——Copy 图标容易被误读成"复制并新建"，分享图标才贴合"复制出去发给同事"的意图。
// URL 取运行时 origin + withBase 拼绝对地址——不依赖 APP_URL 配置，反向代理域名也正确。
// 每行一个本组件实例，copied 态天然隔离；可见性（hover 行浮现）由调用方 className 控制。
export default function IssueRowShareButton({
  number,
  title,
  stateName,
  projectName,
  wsSlug,
  projectSlug,
  className,
}: {
  number: number;
  title: string;
  stateName: string;
  projectName: string;
  wsSlug: string;
  projectSlug: string;
  className?: string;
}) {
  const t = useTranslations("issues");
  const [copied, setCopied] = useState(false);

  async function copyShareText() {
    const url = `${window.location.origin}${withBase(`/w/${wsSlug}/p/${projectSlug}/issues/${number}`)}`;
    try {
      await navigator.clipboard.writeText(
        t("shareText", { project: projectName, number, title, state: stateName, url }),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(t("copiedShareHint"));
    } catch {
      // 非 HTTPS / 剪贴板权限拒绝都走这里（CreateTokenDialog 同模式）——行内动作失败必须给出口
      toast.error(t("copyFailed"));
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => void copyShareText()}
      aria-label={t("shareIssue")}
      title={t("shareIssue")}
    >
      {copied ? <Check className="size-3.5" /> : <Share2 className="size-3.5" />}
    </Button>
  );
}

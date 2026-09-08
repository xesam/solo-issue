"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Editor, JSONContent } from "@tiptap/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { buildMentionSuggestion, type MentionItem } from "./mention-popup";

// 富文本编辑器：工具栏 + @提及 + 粘贴/拖入图片上传（onUploadImage 由页面注：
// IssueForm/CreateIssuePage 落 issue 附件，IssueDetail 评论也走 issue 附件）。
// 受控说明：TipTap 的 content 只在首次挂载生效，doc prop 后续变化由下方
// 同步 effect 兑现——页面在「协作轮询 + 本地未 dirty」时回落服务器新值，
// 若不走这里，挂载后 set 的旧文会在下一次输入时被整体写回（静默回滚协作者修改）。
// minH：编辑区最小高度 class，缺省按 compact 分档（评论 96px / 正文 192px），
// 长文场景由使用处传更高档。

export default function RichEditor({
  doc,
  onUpdate,
  members,
  placeholder,
  compact,
  onUploadImage,
  className,
  minH,
}: {
  doc?: JSONContent | null;
  onUpdate?: (doc: JSONContent) => void;
  members?: MentionItem[];
  placeholder?: string;
  compact?: boolean;
  onUploadImage?: (file: File) => Promise<string>;
  className?: string;
  minH?: string;
}) {
  const membersRef = useRef<MentionItem[]>(members ?? []);
  membersRef.current = members ?? [];
  const uploadRef = useRef(onUploadImage);
  uploadRef.current = onUploadImage;
  const editorRef = useRef<Editor | null>(null);
  const [, tick] = useState(0);
  const t = useTranslations("editor");
  const tLabels = useTranslations("labels");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder ?? t("inputPlaceholder") }),
      Image,
      Mention.configure({
        suggestion: buildMentionSuggestion(() => membersRef.current, tLabels),
      }),
    ],
    content: doc ?? undefined,
    editorProps: {
      attributes: {
        class: cn(
          "rich-content px-3.5 py-2.5 text-sm leading-relaxed outline-none",
          minH ?? (compact ? "min-h-24" : "min-h-48"),
        ),
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!uploadRef.current || !files.some((f) => f.type.startsWith("image/")))
          return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!uploadRef.current || !files.some((f) => f.type.startsWith("image/")))
          return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => onUpdate?.(editor.getJSON()),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // doc prop 的后续变化同步进编辑器（emitUpdate: false——外部的回写不该再
  // 反向触发 onUpdate，否则会把「服务器回了什么」标成本地新改动）
  useEffect(() => {
    if (!editor) return;
    if (doc === null || doc === undefined) {
      // 外部清空（协作者删光描述）：空文档与未聚焦空白同形，须以内容为准判断，
      // 否则「编辑器本来就是空」与「被远程清空」不可区分，旧文会被下一次输入写回
      const empty = JSON.stringify(editor.getJSON()) === JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
      if (!empty) editor.commands.clearContent(false);
      return;
    }
    const next = JSON.stringify(doc);
    if (JSON.stringify(editor.getJSON()) === next) return;
    editor.commands.setContent(doc, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc]);

  // 选区/格式变化时刷新工具栏激活态
  useEffect(() => {
    if (!editor) return;
    const cb = () => tick((v) => v + 1);
    editor.on("transaction", cb);
    return () => {
      editor.off("transaction", cb);
    };
  }, [editor]);

  async function insertImages(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length || !uploadRef.current) return;
    const e = editorRef.current;
    if (!e) return;
    for (const f of images) {
      try {
        const url = await uploadRef.current(f);
        e.chain().focus().setImage({ src: url }).run();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("imageUploadFailed", { name: f.name }));
      }
    }
  }

  if (!editor) return <div className="h-20 animate-pulse rounded-xl bg-muted" />;

  const btn = (
    key: string,
    title: string,
    Icon: LucideIcon,
    action: () => void,
    active?: boolean,
  ) => (
    <Button
      key={key}
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault();
        action();
      }}
      className={cn(
        "size-7",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
    </Button>
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card focus-within:border-ring",
        className,
      )}
    >
      {!compact && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 px-1.5 py-1">
          {btn("bold", t("bold"), Bold, () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
          {btn("italic", t("italic"), Italic, () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
          {btn("strike", t("strike"), Strikethrough, () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
          {btn("h2", t("heading2"), Heading2, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }))}
          {btn("h3", t("heading3"), Heading3, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }))}
          {btn("ul", t("bulletList"), List, () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
          {btn("ol", t("orderedList"), ListOrdered, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
          {btn("quote", t("quote"), Quote, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"))}
          {btn("code", t("codeBlock"), SquareCode, () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"))}
          {btn("link", t("link"), LinkIcon, () => {
            const raw = window.prompt(t("linkPrompt"), "https://");
            const url = raw?.trim();
            // 空值或原样默认值不插入——那只会生成一个指向 https:// 的死链
            if (url && url !== "https://") {
              const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
              editor.chain().focus().setLink({ href }).run();
            }
          }, editor.isActive("link"))}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

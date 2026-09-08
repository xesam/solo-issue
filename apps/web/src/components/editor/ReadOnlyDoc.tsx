"use client";

import type { JSONContent } from "@tiptap/core";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";

// 只读渲染 Tiptap 文档（评论正文等）

export default function ReadOnlyDoc({
  doc,
  className,
}: {
  doc: JSONContent | null;
  className?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: doc ?? undefined,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: true }),
      Image,
      Mention,
    ],
    editorProps: { attributes: { class: "rich-content" } },
  });

  if (!editor) return null;
  return <EditorContent editor={editor} className={className} />;
}

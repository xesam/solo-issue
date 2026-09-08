import type { JSONContent } from "@tiptap/core";

// Tiptap 文档 → 纯文本（服务端派生 descriptionText/bodyText，搜索与 IM 摘要用）
// 客户端与服务端共用（纯函数，无环境依赖）

export function docToText(doc?: JSONContent | null): string {
  if (!doc) return "";
  const blocks: string[] = [];

  const inline = (node: JSONContent | undefined): string => {
    if (!node) return "";
    switch (node.type) {
      case "text":
        return node.text ?? "";
      case "mention":
        return `@${(node.attrs as { label?: string } | undefined)?.label ?? ""}`;
      case "hardBreak":
        return "\n";
      default:
        return (node.content ?? []).map(inline).join("");
    }
  };

  const walk = (node: JSONContent, prefix: string): void => {
    switch (node.type) {
      case "doc":
      case "blockquote":
      case "paragraph":
      case "heading":
        (node.content ?? []).forEach((c) => walk(c, prefix));
        blocks.push("\n");
        break;
      case "bulletList":
        (node.content ?? []).forEach((c) => walk(c, "- "));
        break;
      case "orderedList":
        (node.content ?? []).forEach((c, i) => walk(c, `${i + 1}. `));
        break;
      case "listItem": {
        // 子节点是 paragraph（或嵌套列表）：整段收拢进 inline，
        // 不能只取首内联节点——mark 会把文本切成多节点，只取 [0] 会丢字
        const text = (node.content ?? []).map((c) => inline(c)).join(" ");
        blocks.push(`${prefix}${text}\n`);
        break;
      }
      case "codeBlock": {
        const text = (node.content ?? []).map(inline).join("");
        blocks.push(`${text}\n`);
        break;
      }
      case "image":
        blocks.push("[图片]\n");
        break;
      default:
        blocks.push(inline(node));
    }
  };

  walk(doc, "");
  return blocks.join("").replace(/\n{3,}/g, "\n\n").trim();
}

// 从文档中提取 @提及 的用户 ID 集合（通知引擎用：新提及才触发通知）
export function docToMentions(doc?: JSONContent | null): Set<string> {
  const ids = new Set<string>();
  const walk = (node?: JSONContent | null): void => {
    if (!node) return;
    if (node.type === "mention") {
      const id = (node.attrs as { id?: string } | undefined)?.id;
      if (id) ids.add(id);
    }
    (node.content ?? []).forEach(walk);
  };
  walk(doc);
  return ids;
}

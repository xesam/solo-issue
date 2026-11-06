// Issue 摘要派生（标题概念已废除）：列表/看板/搜索/通知所需的「短行」
// 统一由描述的首个非空行供给。读时派生、无存储列，客户端与服务端共用
// （纯函数，无环境依赖，与 tiptap-text 同层）。

/** descriptionText 的首个非空行（trim 后非空才算），无则空串 */
export function firstValidLine(text: string | null | undefined): string {
  if (!text) return "";
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

/**
 * 消费面摘要：首个有效行，超 max 截断加省略号。
 * max 按消费面传：通知正文对齐既有 300 截断口径，列表/看板由 CSS truncate 兜底。
 */
export function issueSummary(
  descriptionText: string | null | undefined,
  max = 120,
): string {
  const line = firstValidLine(descriptionText);
  return line.length > max ? line.slice(0, max).trimEnd() + "…" : line;
}

import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import type { UserOrigin } from "@prisma/client";
import { credentialHint } from "@/lib/origin-labels";
import type { Translator } from "@/i18n/config";

// @提及 候选弹层（vanilla DOM，无需额外 UI 依赖）

// 候选展示 = 姓名 + 凭据标识（重名可辨：IM 账号显来源、邮箱账号显邮箱）；
// 插入到文档的仍只是 label（姓名）
export type MentionItem = {
  id: string;
  label: string;
  email?: string | null;
  origin?: UserOrigin | null;
};


type PopupProps = SuggestionProps<MentionItem>;

export function buildMentionSuggestion(
  getMembers: () => MentionItem[],
  t: Translator,
): Omit<SuggestionOptions<MentionItem>, "editor"> {
  return {
    char: "@",
    items: ({ query }: { query: string }) => {
      const q = query.toLowerCase();
      return getMembers()
        .filter((m) => m.label.toLowerCase().includes(q))
        .slice(0, 8);
    },
    render: () => {
      let popup: HTMLDivElement | null = null;
      let items: MentionItem[] = [];
      let sel = 0;
      let command: ((item: MentionItem) => void) | null = null;
      let clientRect: (() => DOMRect | null) | null | undefined;

      const destroy = () => {
        popup?.remove();
        popup = null;
        // 会话一并终结：只拆 DOM 的话 Escape 后再按 Enter 仍会静默插入隐藏候选、
        // 方向键仍在暗处移动 sel
        items = [];
        command = null;
      };

      const draw = () => {
        if (!popup) return;
        popup.innerHTML = "";
        if (!items.length) {
          popup.style.display = "none";
          popup.removeAttribute("aria-activedescendant");
          return;
        }
        popup.style.display = "block";
        items.forEach((it, i) => {
          const el = document.createElement("button");
          el.type = "button";
          // listbox/option 语义：读屏播报候选列表，键盘选中项随 aria-activedescendant
          // 跟踪（与 GlobalSearch 结果区同构，UI 自动化也因此可走 role 定位）
          el.role = "option";
          el.id = `mention-option-${i}`;
          el.setAttribute("aria-selected", String(i === sel));
          const hint = credentialHint(t, it);
          if (hint) {
            const name = document.createElement("span");
            name.textContent = it.label;
            const mail = document.createElement("span");
            mail.textContent = hint;
            mail.className = "ml-2 text-xs text-muted-foreground";
            el.append(name, mail);
          } else {
            el.textContent = it.label;
          }
          el.className =
            i === sel
              ? "w-full bg-primary/10 px-2.5 py-1.5 text-left text-sm text-primary"
              : "w-full px-2.5 py-1.5 text-left text-sm text-foreground/80 hover:bg-accent";
          el.onmousedown = (e) => {
            e.preventDefault();
            command?.(it);
            destroy();
          };
          popup!.appendChild(el);
        });
        popup.setAttribute("aria-activedescendant", `mention-option-${sel}`);
      };

      const place = () => {
        const rect = clientRect?.();
        if (!rect || !popup) return;
        // clientRect 本身是视口坐标，弹层是 fixed——直接用，禁止再叠加
        // scrollX/scrollY（那是 absolute 定位的公式；页面滚动会偏移一个滚动量）
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 6}px`;
      };

      return {
        onStart: (props: PopupProps) => {
          items = props.items;
          sel = 0;
          command = props.command;
          clientRect = props.clientRect;
          popup = document.createElement("div");
          popup.role = "listbox";
          popup.id = "mention-suggestions";
          popup.setAttribute("aria-label", t("mentionCandidates"));
          popup.className =
            "fixed z-50 flex min-w-36 flex-col overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg";
          draw();
          place();
          document.body.appendChild(popup);
        },
        onUpdate: (props: PopupProps) => {
          items = props.items;
          sel = 0;
          command = props.command;
          clientRect = props.clientRect;
          draw();
          place();
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          const { event } = props;
          if (event.key === "ArrowDown" && items.length) {
            sel = (sel + 1) % items.length;
            draw();
            return true;
          }
          if (event.key === "ArrowUp" && items.length) {
            sel = (sel - 1 + items.length) % items.length;
            draw();
            return true;
          }
          if (event.key === "Enter" && items.length) {
            command?.(items[sel]);
            destroy();
            return true;
          }
          if (event.key === "Escape") {
            destroy(); // 会终结整个 suggestion 会话：后续 Enter/方向键不再响应
            return true;
          }
          return false;
        },
        onExit: () => destroy(),
      };
    },
  };
}

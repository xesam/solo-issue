import { describe, expect, it } from "vitest";
import { docToMentions, docToText } from "@/lib/tiptap-text";

describe("docToText", () => {
  it("空文档返回空串", () => {
    expect(docToText(undefined)).toBe("");
    expect(docToText(null)).toBe("");
  });

  it("段落文本拼接", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "World" }] },
      ],
    };
    expect(docToText(doc)).toBe("Hello\nWorld");
  });

  it("多行折叠为最多一个空行（连续空段产出 \\n{3,} 后折叠，规则必须真执行）", () => {
    // 每个空段落产出一个换行，连续 3 个空段 → "\na\n\n\n\nb"，折叠后仅余一个空行；
    // 若折叠替换退化成 no-op，下一条断言红（原夹具无连续空段，规则从未被踩到）
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    };
    expect(docToText(doc)).toBe("a\n\nb");
    // 无空段的普通多行不折叠
    expect(
      docToText({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
          { type: "paragraph", content: [{ type: "text", text: "b" }] },
        ],
      }),
    ).toBe("a\nb");
  });

  it("mention 节点渲染为 @label", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "hi " },
            { type: "mention", attrs: { id: "u1", label: "张三" } },
          ],
        },
      ],
    };
    expect(docToText(doc)).toBe("hi @张三");
  });

  it("hardBreak 渲染为换行", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }],
        },
      ],
    };
    expect(docToText(doc)).toBe("a\nb");
  });

  it("无序列表拼 - 前缀，有序列表拼序号", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
          ],
        },
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "一" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "二" }] }] },
          ],
        },
      ],
    };
    expect(docToText(doc)).toBe("- 甲\n- 乙\n1. 一\n2. 二");
  });

  it("codeBlock 原样收拢", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const a = 1;" }],
        },
      ],
    };
    expect(docToText(doc)).toBe("const a = 1;");
  });

  it("image 节点渲染为占位文本（mark 切断的内联节点全部保留）", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "前" },
            { type: "image", attrs: { src: "x.png" } },
            { type: "text", text: "后" },
          ],
        },
      ],
    };
    expect(docToText(doc)).toBe("前[图片]\n后");
  });

  it("listItem 内嵌多内联节点不丢字", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", marks: [{ type: "bold" }], text: "加粗" },
                    { type: "text", text: "与普通" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(docToText(doc)).toBe("- 加粗与普通");
  });
});

describe("docToMentions", () => {
  it("空文档返回空集合", () => {
    expect(docToMentions(undefined).size).toBe(0);
  });

  it("收集嵌套文档内全部 mention id 并去重", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "u1", label: "A" } },
            { type: "mention", attrs: { id: "u1", label: "A" } },
            { type: "mention", attrs: { id: "u2", label: "B" } },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "mention", attrs: { id: "u3" } }],
            },
          ],
        },
        { type: "mention", attrs: {} }, // 无 id 的坏节点不炸
      ],
    };
    expect([...docToMentions(doc)].sort()).toEqual(["u1", "u2", "u3"]);
  });
});

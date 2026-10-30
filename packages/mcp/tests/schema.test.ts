import { describe, expect, it } from "vitest";
import { z } from "zod";
import { commentTools } from "../src/tools/comments";
import { discoveryTools } from "../src/tools/discovery";
import { issueTools } from "../src/tools/issues";
import { searchTools } from "../src/tools/search";

// 回归锁：SDK 在 tools/call 时按 inputSchema 校验参数——可选字段必须显式 .optional()，
// 否则最小调用集被拒（filters/fieldValues 两度在真实链路踩中：单测直调 run 绕过 SDK 校验抓不到）。
// 本文件用 z.object(rawShape).parse 模拟 SDK 校验路径，把这类契约缺陷锁进单测层

const byName = <S extends { name: string; inputSchema: z.ZodRawShape }>(
  all: S[],
  name: string,
): S => all.find((t) => t.name === name)!;

describe("SDK 端 zod 语义（最小参数集必须可通过校验）", () => {
  it("search_everything 可只传 q（filters 可缺省——历史缺陷回归）", () => {
    expect(() => z.object(byName(searchTools, "search_everything").inputSchema).parse({ q: "x" })).not.toThrow();
  });

  it("create_issue 只需 projectId + title（fieldValues 可缺省——历史缺陷回归）", () => {
    expect(() =>
      z.object(byName(issueTools, "create_issue").inputSchema).parse({ projectId: "p", title: "t" }),
    ).not.toThrow();
  });

  it("update_issue 除 projectId + number 外全部可缺省", () => {
    expect(() =>
      z.object(byName(issueTools, "update_issue").inputSchema).parse({ projectId: "p", number: 1 }),
    ).not.toThrow();
  });

  it("whoami / list_workspaces 零参可调；list_projects / list_members 的 wsSlug 必填", () => {
    expect(() => z.object(byName(discoveryTools, "whoami").inputSchema).parse({})).not.toThrow();
    expect(() => z.object(byName(discoveryTools, "list_workspaces").inputSchema).parse({})).not.toThrow();
    // wsSlug 必填化：缺参在 SDK 调用层即拒——缺省值会静默遮蔽其余工作区
    expect(() => z.object(byName(discoveryTools, "list_projects").inputSchema).parse({})).toThrow();
    expect(() => z.object(byName(discoveryTools, "list_projects").inputSchema).parse({ wsSlug: "main" })).not.toThrow();
    expect(() => z.object(byName(discoveryTools, "list_members").inputSchema).parse({})).toThrow();
    expect(() => z.object(byName(discoveryTools, "list_members").inputSchema).parse({ wsSlug: "main" })).not.toThrow();
  });

  it("add_comment 的 body 必填（Tiptap 文档）", () => {
    expect(() =>
      z.object(byName(commentTools, "add_comment").inputSchema).parse({ projectId: "p", number: 1 }),
    ).toThrow();
    expect(() =>
      z.object(byName(commentTools, "add_comment").inputSchema).parse({
        projectId: "p",
        number: 1,
        body: { type: "doc" },
      }),
    ).not.toThrow();
  });
});

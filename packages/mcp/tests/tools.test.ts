import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/http";
import { commentTools } from "../src/tools/comments";
import { discoveryTools } from "../src/tools/discovery";
import { toolNames } from "../src/tools/index";
import { issueTools } from "../src/tools/issues";
import { searchTools } from "../src/tools/search";

// 经真 ApiClient + mock fetch 驱动每个工具：断言 URL/方法/body 的纯透传准确性。
// run 的 args 走 never 桥接：具体规格的参数类型在各工具文件由 zod 推导，测试侧不重复声明

const cfg = { baseUrl: "http://t/solo-issue", token: "itr_x" };

const newApi = (ret: { status: number; body: unknown }) => {
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(ret.body), { status: ret.status }),
  );
  return { api: new ApiClient(cfg, fetchImpl as unknown as typeof fetch), fetchImpl };
};

type AnyRun = (api: ApiClient, args: never) => Promise<unknown>;

const run = async (
  spec: { run: AnyRun },
  args: unknown,
  ret: { status: number; body: unknown } = { status: 200, body: { data: {} } },
) => {
  const { api, fetchImpl } = newApi(ret);
  const data = await spec.run(api, args as never);
  const call = fetchImpl.mock.calls[0];
  return {
    data,
    url: String(call?.[0]),
    init: call?.[1] as RequestInit,
  };
};

const byName = <S extends { name: string }>(all: S[], name: string): S =>
  all.find((t) => t.name === name)!;

const all = [...discoveryTools, ...searchTools, ...issueTools, ...commentTools] as {
  name: string;
  run: AnyRun;
}[];

describe("工具面清单", () => {
  it("13 个工具全覆盖（与 docs/11-mcp-adapter.md §3.1 一致）", () => {
    expect(toolNames.sort()).toEqual(
      [
        "whoami",
        "list_workspaces",
        "list_projects",
        "list_states",
        "list_members",
        "get_fields_schema",
        "search_everything",
        "list_issues",
        "read_issue",
        "read_history",
        "create_issue",
        "update_issue",
        "add_comment",
      ].sort(),
    );
  });
});

describe("discover 细粒度工具", () => {
  it("whoami/list_workspaces 无参；wsSlug 与 projectId 进路径并做段编码", async () => {
    expect((await run(byName(discoveryTools, "whoami"), {})).url).toBe(
      "http://t/solo-issue/api/me",
    );
    expect((await run(byName(discoveryTools, "list_workspaces"), {})).url).toBe(
      "http://t/solo-issue/api/workspaces",
    );
    expect((await run(byName(discoveryTools, "list_projects"), { wsSlug: "corp ops" })).url).toBe(
      "http://t/solo-issue/api/workspaces/corp%20ops/projects",
    );
    expect((await run(byName(discoveryTools, "list_states"), { projectId: "p1" })).url).toBe(
      "http://t/solo-issue/api/projects/p1/states",
    );
    expect((await run(byName(discoveryTools, "get_fields_schema"), { projectId: "p1" })).url).toBe(
      "http://t/solo-issue/api/projects/p1/fields/schema",
    );
    expect((await run(byName(discoveryTools, "list_members"), { wsSlug: "corp ops" })).url).toBe(
      "http://t/solo-issue/api/workspaces/corp%20ops/members",
    );
  });
});

describe("search_everything", () => {
  it("filters 转译 cf.*，与 q 合流进 query", async () => {
    const r = await run(byName(searchTools, "search_everything"), {
      q: "线上",
      filters: { severity: "s1" },
    });
    expect(r.url).toBe("http://t/solo-issue/api/search?q=%E7%BA%BF%E4%B8%8A&cf.severity=s1");
  });
});

describe("issue 工具", () => {
  it("list_issues：固定参数 + cf.*，projectId 只进路径", async () => {
    const r = await run(byName(issueTools, "list_issues"), {
      projectId: "p1",
      stateId: "s1",
      filters: { customer: "ACME" },
      page: 2,
    });
    expect(r.url).toBe(
      "http://t/solo-issue/api/projects/p1/issues?stateId=s1&page=2&cf.customer=ACME",
    );
    expect(r.init.method).toBe("GET");
  });

  it("read_issue / read_history：路径序号拼接", async () => {
    expect((await run(byName(issueTools, "read_issue"), { projectId: "p1", number: 12 })).url).toBe(
      "http://t/solo-issue/api/projects/p1/issues/12",
    );
    expect(
      (await run(byName(issueTools, "read_history"), { projectId: "p1", number: 12 })).url,
    ).toBe("http://t/solo-issue/api/projects/p1/issues/12/activities");
  });

  it("create_issue：POST body 字段透传", async () => {
    const r = await run(byName(issueTools, "create_issue"), {
      projectId: "p1",
      title: "t",
      assigneeIds: ["u1"],
      fieldValues: { severity: "s1" },
    });
    expect(r.url).toBe("http://t/solo-issue/api/projects/p1/issues");
    expect(r.init.method).toBe("POST");
    expect(JSON.parse(String(r.init.body))).toEqual({
      title: "t",
      descriptionText: undefined,
      stateId: undefined,
      assigneeIds: ["u1"],
      fieldValues: { severity: "s1" },
    });
  });

  it("update_issue：PATCH 部分更新 body", async () => {
    const r = await run(byName(issueTools, "update_issue"), {
      projectId: "p1",
      number: 3,
      isArchived: true,
    });
    expect(r.url).toBe("http://t/solo-issue/api/projects/p1/issues/3");
    expect(r.init.method).toBe("PATCH");
    expect(JSON.parse(String(r.init.body))).toEqual({
      title: undefined,
      descriptionText: undefined,
      stateId: undefined,
      assigneeIds: undefined,
      fieldValues: undefined,
      isArchived: true,
    });
  });
});

describe("add_comment", () => {
  it("Tiptap 文档包在 body 键下", async () => {
    const doc = { type: "doc", content: [] };
    const r = await run(byName(commentTools, "add_comment"), {
      projectId: "p1",
      number: 5,
      body: doc,
    });
    expect(r.url).toBe("http://t/solo-issue/api/projects/p1/issues/5/comments");
    expect(JSON.parse(String(r.init.body))).toEqual({ body: doc });
  });
});

describe("错误透传（工具层不吞错）", () => {
  it("422 字段明细随 ApiHttpError 冒出，交由注册层转译为 isError 指引", async () => {
    const { api } = newApi({ status: 422, body: { error: "fieldValues.severity: 超出枚举" } });
    await expect(
      byName(issueTools, "create_issue").run(api, { projectId: "p1", title: "x" } as never),
    ).rejects.toMatchObject({ status: 422, message: "fieldValues.severity: 超出枚举" });
  });

  it("全部工具经 all 聚合可寻址（与注册器 toolNames 同源）", () => {
    // 漂移闸：四个工具数组的名字并集须与 index 的 specs 注册名完全一致
    //（新工具文件若只接了测试没接注册器，或反之，此处红）
    expect(all.map((t) => t.name).sort()).toEqual(toolNames.slice().sort());
  });
});

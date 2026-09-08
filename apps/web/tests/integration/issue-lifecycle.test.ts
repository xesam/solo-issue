// vi.mock 必须悬置于 import 之前（vitest 会提升到文件顶部）：隔离 IM 队列，
// 避免测试把站内推送 job 留在真实队列里（dispatchIm 本就是尽力而为的旁路）
vi.mock("@/server/queue", () => ({
  IM_SEND_QUEUE: "notifications.im.send",
  getBoss: () => Promise.resolve({ send: async () => {} }),
}));

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { State } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/api";
import { createCustomField } from "@/server/services/custom-field";
import { DEFAULT_STATES, updateProject } from "@/server/services/project";
import { createState, deleteState, listStates, updateState } from "@/server/services/state";
import {
  batchUpdateIssues,
  createIssue,
  deleteIssue,
  getIssue,
  listIssues,
  updateIssue,
} from "@/server/services/issue";
import { createComment, listComments } from "@/server/services/comment";
import { listTimeline } from "@/server/services/timeline";
import { createView, deleteView, listViews } from "@/server/services/view";
import { cleanupFixtures, mkProject, mkUser, mkWorkspace, addMember } from "./helpers";

let owner!: Awaited<ReturnType<typeof mkUser>>;
let member!: Awaited<ReturnType<typeof mkUser>>;
let ws!: Awaited<ReturnType<typeof mkWorkspace>>;
let project!: Awaited<ReturnType<typeof mkProject>>;
let states!: State[];
let inProgress!: State;
let done!: State;
let canceled!: State;
const actor = () => ({ id: owner.id, name: owner.name });

beforeAll(async () => {
  owner = await mkUser({ name: "创建者" });
  member = await mkUser({ name: "被指派人" });
  ws = await mkWorkspace(owner.id);
  await addMember(ws.id, member.id, "MEMBER"); // 通知收件人必须是工作区成员（emitNotifications 护栏）
  project = await mkProject(ws.id, owner.id);
  states = await listStates(project.id);
  inProgress = states.find((s) => s.name === "进行中")!;
  done = states.find((s) => s.group === "COMPLETED")!;
  canceled = states.find((s) => s.group === "CANCELLED")!;
});

afterAll(cleanupFixtures);

describe("项目与状态地基", () => {
  it("createProject：建默认 5 状态（互斥分组 + 默认态），creator 为项目 ADMIN", async () => {
    expect(states.map((s) => s.name)).toEqual(DEFAULT_STATES.map((s) => s.name));
    expect(states.filter((s) => s.isDefault)).toHaveLength(1);
    expect(states.find((s) => s.isDefault)?.group).toBe("ACTIVE");
    const pm = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: owner.id } },
    });
    expect(pm?.role).toBe("ADMIN");
  });

  it("状态 CRUD：重名 409、挂着 issue 删 409、合法改名/换色", async () => {
    const st = await createState(project.id, { name: "验证中毒", color: "#112233" });
    try {
      await createState(project.id, { name: "验证中毒" });
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(409);
    }
    const renamed = await updateState(project.id, st.id, { name: "验证中", color: "#445566" });
    expect(renamed.name).toBe("验证中");
    expect(renamed.color).toBe("#445566");

    const issue = await createIssue(project.id, { title: "占位置", stateId: st.id }, actor());
    try {
      await deleteState(project.id, st.id);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(409);
    }
    // 挪回进行中腾空该状态后可删
    await updateIssue(project.id, issue.number, { stateId: inProgress.id }, actor());
    await deleteState(project.id, st.id);
    expect((await listStates(project.id)).some((s) => s.id === st.id)).toBe(false);
  });

  it("updateProject：改名/归档/私有切换", async () => {
    const up = await updateProject(project.id, { isArchived: true, name: "新名" });
    expect(up.isArchived).toBe(true);
    expect(up.name).toBe("新名");
    const flipped = await updateProject(project.id, { isPrivate: true });
    expect(flipped.isPrivate).toBe(true);
    const restored = await updateProject(project.id, { isArchived: false, isPrivate: false });
    expect(restored.isArchived).toBe(false);
    expect(restored.isPrivate).toBe(false);
  });
});

describe("issue 创建", () => {
  it("序号自增、默认状态、CREATED 活动落库", async () => {
    const i1 = await createIssue(project.id, { title: "第一" }, actor());
    const i2 = await createIssue(project.id, { title: "第二" }, actor());
    // 序号是项目内计数器：前导状态组已占号，此处锚定「连续自增 + 正值」；
    // 项目内唯一由 schema @@unique([projectId, number]) 数据库级保证，不再重复断言
    expect(i1.number).toBeGreaterThan(0);
    expect(i2.number).toBe(i1.number + 1);
    expect(i1.state?.id).toBe(states.find((s) => s.isDefault)?.id);
    expect(i1.creator.id).toBe(owner.id);
    const created = await prisma.activity.count({
      where: { issueId: i1.id, action: "CREATED" },
    });
    expect(created).toBe(1);
  });

  it("stateId 显式传 null 有意留「无状态」；缺省才落默认（与 updateIssue 的 null=disconnect 同语义）", async () => {
    const none = await createIssue(project.id, { title: "无状态行", stateId: null }, actor());
    expect(none.state).toBeNull();
    const dflt = await createIssue(project.id, { title: "默认状态行" }, actor());
    expect(dflt.state?.id).toBe(states.find((s) => s.isDefault)?.id);
  });

  it("Tiptap 描述派生 descriptionText（搜索/通知摘要用）", async () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "复现步骤" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "打开首页" }] }] },
          ],
        },
      ],
    } as const;
    const i = await createIssue(project.id, { title: "描述", description: doc }, actor());
    expect(i.descriptionText).toBe("复现步骤\n- 打开首页");
    // 显式 null = 有意无描述
    const j = await createIssue(project.id, { title: "无描述", description: null }, actor());
    expect(j.descriptionText).toBe("");
  });

  it("创建即指派：ASSIGNED 活动 + 被指派者通知（操作者自指派不打扰）", async () => {
    const i = await createIssue(project.id, { title: "指派", assigneeIds: [member.id] }, actor());
    expect(i.assignees.map((a) => a.user.id)).toEqual([member.id]);
    expect(
      await prisma.activity.count({ where: { issueId: i.id, action: "ASSIGNED" } }),
    ).toBe(1);
    const n = await prisma.notification.findFirst({
      where: { issueId: i.id, userId: member.id, type: "ASSIGNED" },
    });
    expect(n).toBeTruthy();
    expect(n!.url).toContain(`/w/${ws.slug}/p/${project.slug}/issues/${i.number}`);
    expect(await prisma.notification.count({ where: { issueId: i.id, userId: owner.id } })).toBe(0);
  });

  it("描述内 @mention 触发 MENTIONED 通知；指派不可见成员拒绝 422", async () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "交给你 " },
            { type: "mention", attrs: { id: member.id, label: member.name } },
          ],
        },
      ],
    } as const;
    const i = await createIssue(project.id, { title: "提及", description: doc, assigneeIds: [] }, actor());
    expect(
      await prisma.notification.count({ where: { issueId: i.id, userId: member.id, type: "MENTIONED" } }),
    ).toBe(1);

    const stranger = await mkUser({ name: "路人" });
    try {
      await createIssue(project.id, { title: "坏指派", assigneeIds: [stranger.id] }, actor());
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(422);
    }
  });
});

describe("issue 更新", () => {
  let i!: Awaited<ReturnType<typeof createIssue>>;

  beforeAll(async () => {
    i = await createIssue(project.id, { title: "更新主角", assigneeIds: [member.id] }, actor());
  });

  it("改标题落 UPDATED 活动；同值重复提交不产生伪活动", async () => {
    await updateIssue(project.id, i.number, { title: "更新主角（改）" }, actor());
    expect(
      await prisma.activity.count({ where: { issueId: i.id, action: "UPDATED", field: "title" } }),
    ).toBe(1);
    await updateIssue(project.id, i.number, { title: "更新主角（改）" }, actor());
    expect(
      await prisma.activity.count({ where: { issueId: i.id, action: "UPDATED", field: "title" } }),
    ).toBe(1);
  });

  it("进入 COMPLETED 打点 completedAt；移出 COMPLETED 组（转 CANCELLED/ACTIVE）清空；再进重新打点", async () => {
    await updateIssue(project.id, i.number, { stateId: done.id }, actor());
    const marked = (await getIssue(project.id, i.number)).completedAt;
    expect(marked).toBeTruthy();
    expect(
      await prisma.activity.count({
        where: { issueId: i.id, action: "STATE_CHANGED", field: "state" },
      }),
    ).toBe(1);
    // 关注者（被指派人）得 STATE_CHANGED 通知；操作者本人无
    expect(
      await prisma.notification.count({
        where: { issueId: i.id, userId: member.id, type: "STATE_CHANGED" },
      }),
    ).toBe(1);

    // 完成 → 取消：移出 COMPLETED 组，completedAt 必须清空
    await updateIssue(project.id, i.number, { stateId: canceled.id }, actor());
    expect((await getIssue(project.id, i.number)).completedAt).toBeNull();

    // 再进 COMPLETED：重新打点
    await updateIssue(project.id, i.number, { stateId: done.id }, actor());
    expect((await getIssue(project.id, i.number)).completedAt).toBeTruthy();
  });

  it("完成态之间搬运不刷新 completedAt（保留首次完成时间）", async () => {
    const first = (await getIssue(project.id, i.number)).completedAt!;
    const accepted = await createState(project.id, { name: "验收通过", group: "COMPLETED" });
    await updateIssue(project.id, i.number, { stateId: accepted.id }, actor());
    const after = await getIssue(project.id, i.number);
    expect(after.state?.id).toBe(accepted.id);
    expect(after.completedAt?.getTime()).toBe(first.getTime());
  });

  it("指派变更：UNASSIGNED/ASSIGNED 活动成对，通知只给新指派者", async () => {
    const third = await mkUser({ name: "第三人" });
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: third.id, role: "MEMBER" },
    });
    await updateIssue(project.id, i.number, { assigneeIds: [third.id] }, actor());
    expect(
      await prisma.activity.count({ where: { issueId: i.id, action: "UNASSIGNED" } }),
    ).toBe(1);
    expect(
      await prisma.activity.count({ where: { issueId: i.id, action: "ASSIGNED" } }),
    ).toBe(2); // 创建时 1 + 本次 1
    expect(
      await prisma.notification.count({ where: { issueId: i.id, userId: third.id, type: "ASSIGNED" } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { issueId: i.id, userId: member.id, type: "ASSIGNED" } }),
    ).toBe(1); // 历史通知不删
  });

  let archIssue!: Awaited<ReturnType<typeof createIssue>>;

  it("归档落 ARCHIVED 活动；列表默认排除、archived=true 才可见", async () => {
    archIssue = await createIssue(project.id, { title: "将归档" }, actor());
    await updateIssue(project.id, archIssue.number, { isArchived: true }, actor());
    expect(
      await prisma.activity.count({ where: { issueId: archIssue.id, action: "ARCHIVED" } }),
    ).toBe(1);
    const live = await listIssues(project.id, {}, 1, 50);
    expect(live.issues.some((x) => x.id === archIssue.id)).toBe(false);
    const trashed = await listIssues(project.id, { archived: true }, 1, 50);
    expect(trashed.issues.some((x) => x.id === archIssue.id)).toBe(true);
    // 归档不删数据：详情仍可读
    expect(await getIssue(project.id, archIssue.number)).toBeTruthy();
  });

  it("更新子孙路径护栏：未知状态 id 与跨项目状态 id 均 422", async () => {
    try {
      await updateIssue(project.id, i.number, { stateId: "cuid-not-exist" }, actor());
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(422);
    }
    // 跨项目归属分支：另一项目的合法状态 id 也不许改写本项目的状态
    const otherWs = await mkWorkspace(owner.id);
    const otherProject = await mkProject(otherWs.id, owner.id);
    const otherState = (await listStates(otherProject.id)).find((x) => x.isDefault);
    try {
      await updateIssue(project.id, i.number, { stateId: otherState!.id }, actor());
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(422);
    }
    try {
      await updateIssue(project.id, 999999, { title: "无此行" }, actor());
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(404);
    }
  });
});

describe("issue 列表与检索", () => {
  it("q 关键词命中标题与描述全文", async () => {
    const hit = await createIssue(
      project.id,
      { title: "普通标题", descriptionText: "PAYNET-777 特殊标记" },
      actor(),
    );
    const byTitle = await listIssues(project.id, { q: "更新主角" }, 1, 50);
    expect(byTitle.total).toBeGreaterThan(0);
    const byDesc = await listIssues(project.id, { q: "PAYNET-777" }, 1, 50);
    expect(byDesc.issues.some((x) => x.id === hit.id)).toBe(true);
    // 负锚：先种一条不命中的行，再检索——q 过滤退化成 no-op（全量返回）时，
    // 排除断言与严格计数（全项目只有 hit 的描述含 PAYNET-777）都会红
    const miss = await createIssue(project.id, { title: "绝不命中噪音行" }, actor());
    const reQueried = await listIssues(project.id, { q: "PAYNET-777" }, 1, 50);
    expect(reQueried.issues.some((x) => x.id === miss.id)).toBe(false);
    expect(reQueried.issues.some((x) => x.id === hit.id)).toBe(true);
    expect(reQueried.total).toBe(1);
  });

  it("页码式分页：total/page/pageSize 口径一致", async () => {
    const all = await listIssues(project.id, {}, 1, 50);
    expect(all.total).toBe(all.issues.length);
    // 前置断言取代条件守卫：fixture 不足时显式红，而非静默跳过断言体
    expect(all.total).toBeGreaterThanOrEqual(2);
    {
      const half = await listIssues(project.id, {}, 1, 1);
      expect(half.issues).toHaveLength(1);
      const rest = await listIssues(project.id, {}, 2, 1);
      expect(rest.total).toBe(all.total);
      expect(rest.issues[0]?.id).toBe(all.issues[1]?.id);
    }
  });

  it("按 SELECT 自定义字段等值/包含过滤；非可检索类型退化为不过滤", async () => {
    const f = await createCustomField(
      project.id,
      {
        key: "sev",
        name: "严重度",
        type: "SELECT",
        options: [
          { value: "low", label: "低" },
          { value: "high", label: "高" },
        ],
      },
      { id: owner.id },
    );
    const a = await createIssue(project.id, { title: "过滤A", fieldValues: { sev: "high" } }, actor());
    await createIssue(project.id, { title: "过滤B", fieldValues: { sev: "low" } }, actor());

    const byHigh = await listIssues(project.id, { fieldValues: { sev: "high" } }, 1, 50);
    expect(byHigh.issues.some((x) => x.id === a.id)).toBe(true);
    expect(byHigh.issues.every((x) => (x.fieldValues as Record<string, unknown>)?.sev === "high")).toBe(true);

    const ghost = await listIssues(project.id, { fieldValues: { not_a_field: "x" } }, 1, 50);
    const unfiltered = await listIssues(project.id, {}, 1, 50);
    expect(ghost.total).toBe(unfiltered.total); // 未定义 key 不报错、不过滤

    // 已定义但不可检索的类型（TEXT）同样退化为不过滤——这是 customFieldConditions
    // 的另一独立分支（type !== "SELECT"），与「未定义 key」不是同一条路径
    const textF = await createCustomField(
      project.id,
      { key: "zone", name: "区域", type: "TEXT" },
      { id: owner.id },
    );
    const marked = await createIssue(
      project.id,
      { title: "过滤C", fieldValues: { zone: "清仓大甩卖" } },
      actor(),
    );
    const byZone = await listIssues(project.id, { fieldValues: { zone: "清仓大甩卖" } }, 1, 50);
    const allNow = await listIssues(project.id, {}, 1, 50); // 基线取在种行之后，两数同刻
    expect(byZone.total).toBe(allNow.total); // TEXT 不参与检索 → 不过滤
    expect(byZone.issues.some((x) => x.id === marked.id)).toBe(true); // 载有该值的行不被排除
    void textF;
  });
});

describe("批量更新", () => {
  it("部分失败不影响已成功项，failed 回报原因", async () => {
    const a = await createIssue(project.id, { title: "批量1" }, actor());
    const b = await createIssue(project.id, { title: "批量2" }, actor());
    const res = await batchUpdateIssues(
      project.id,
      [a.number, b.number, 999999],
      { stateId: inProgress.id },
      actor(),
    );
    expect(res.updated.sort((x, y) => x - y)).toEqual([a.number, b.number].sort((x, y) => x - y));
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.number).toBe(999999);
    expect((await getIssue(project.id, a.number)).state?.id).toBe(inProgress.id);
    expect((await getIssue(project.id, b.number)).state?.id).toBe(inProgress.id);
  });
});

describe("评论与时间线", () => {
  let i!: Awaited<ReturnType<typeof createIssue>>;

  beforeAll(async () => {
    i = await createIssue(project.id, { title: "评论宿主", assigneeIds: [member.id] }, actor());
  });

  it("空文档评论 422；有效评论派生 bodyText + COMMENTED 活动", async () => {
    try {
      await createComment(project.id, i.number, { type: "doc", content: [] }, actor());
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(422);
    }
    const body = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "看上去是环境问题" }] },
      ],
    };
    const c = await createComment(project.id, i.number, body, actor());
    expect(c.bodyText).toBe("看上去是环境问题");
    expect(c.author.id).toBe(owner.id);
    expect(
      await prisma.notification.count({ where: { issueId: i.id, userId: member.id, type: "COMMENTED" } }),
    ).toBe(1); // 被指派人收到评论通知
  });

  it("@mention 在评论中绕过 COMMENTED、单发 MENTIONED（不重复打扰）", async () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "请评估 " },
            { type: "mention", attrs: { id: member.id, label: member.name } },
          ],
        },
      ],
    };
    await createComment(project.id, i.number, body, actor());
    expect(
      await prisma.notification.count({ where: { issueId: i.id, userId: member.id, type: "MENTIONED" } }),
    ).toBe(1);
    // member 本应是上条评论的 COMMENTED 收件人，但本轮被提及 → 只发 MENTIONED
    const commentedCount = await prisma.notification.count({
      where: { issueId: i.id, userId: member.id, type: "COMMENTED" },
    });
    expect(commentedCount).toBe(1);
  });

  it("listTimeline 合并流：评论卡片 + 非 COMMENTED 活动按时间升序，COMMENTED 活动去重隐藏", async () => {
    const tl = await listTimeline(project.id, i.number);
    const kinds = tl.items.map((x) => x.kind);
    expect(kinds).toContain("comment");
    expect(kinds).toContain("activity"); // CREATED
    // 时间升序
    const createdAts = tl.items.map((x) => x.createdAt.getTime());
    expect([...createdAts].sort((a, b) => a - b)).toEqual(createdAts);
    // 评论的 COMMENTED 活动不重复出现
    const commentCards = tl.items.filter((x) => x.kind === "comment");
    expect(commentCards.length).toBe(2); // 上一、上二两条
    expect(tl.items.some((x) => x.kind === "activity" && (x as { action?: string }).action === "COMMENTED")).toBe(false);
  });

  it("listComments 游标翻页完整不漏", async () => {
    const first = await listComments(project.id, i.number);
    expect(first.total).toBe(2);
    // author 画像与 USER_LITE 同口径（含 origin）——select 漂移（曾漏 origin）在此锚定
    expect(first.comments.every((c) => c.author && typeof c.author.origin === "string")).toBe(true);
    const newest = first.comments[first.comments.length - 1];
    const oldest = first.comments[0];
    const earlier = await listComments(project.id, i.number, {
      before: newest.createdAt,
      beforeId: newest.id,
    });
    expect(earlier.hasMore).toBe(false);
    expect(earlier.total).toBe(2);
    // 内容锚定：第二页必须是「更早的那一条」——游标过滤坏成空页或重复页都会红
    expect(earlier.comments).toHaveLength(1);
    expect(earlier.comments[0]?.id).toBe(oldest.id);
  });
});

describe("保存视图", () => {
  it("query 非法 JSON 422；合法保存留痕、删除 404 幂等", async () => {
    try {
      await createView(project.id, { name: "坏", query: "not-json" }, owner.id);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(422);
    }
    const v = await createView(project.id, { name: "我的入选", query: JSON.stringify({ stateId: inProgress.id }) }, owner.id);
    expect((await listViews(project.id)).some((x) => x.id === v.id)).toBe(true);
    await deleteView(project.id, v.id);
    try {
      await deleteView(project.id, v.id);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(404);
    }
  });
});

describe("issue 删除", () => {
  it("物理删除后详情 404", async () => {
    const i = await createIssue(project.id, { title: "将删除" }, actor());
    await deleteIssue(project.id, i.number);
    try {
      await getIssue(project.id, i.number);
      expect.unreachable();
    } catch (e) {
      expect((e as HttpError).status).toBe(404);
    }
  });
});

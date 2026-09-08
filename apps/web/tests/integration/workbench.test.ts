// IM 队列隔离：createIssue 提交后会把推送 job 入 pg-boss 队列——
// 测试环境隔离该旁路（站内通知不受影响），vi.mock 由 vitest 提升到 import 之前
vi.mock("@/server/queue", () => ({
  IM_SEND_QUEUE: "notifications.im.send",
  getBoss: () => Promise.resolve({ send: async () => {} }),
}));

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getWorkbench } from "@/server/services/workbench";
import { createIssue, updateIssue } from "@/server/services/issue";
import { listStates } from "@/server/services/state";
import { addMember, cleanupFixtures, mkProject, mkUser, mkWorkspace } from "./helpers";

// 个人工作台：跨项目聚合的开放态语义 / 项目可见性并集 / ws 收窄

let me!: Awaited<ReturnType<typeof mkUser>>; // 工作台主人（ws MEMBER + 私有项目 MEMBER）
let colleague!: Awaited<ReturnType<typeof mkUser>>; // 建项目的同事（ws OWNER）
let ws!: Awaited<ReturnType<typeof mkWorkspace>>;
let pub!: Awaited<ReturnType<typeof mkProject>>;
let priv!: Awaited<ReturnType<typeof mkProject>>;
let assignedOpen!: Awaited<ReturnType<typeof createIssue>>;
let assignedDone!: Awaited<ReturnType<typeof createIssue>>;
let createdMine!: Awaited<ReturnType<typeof createIssue>>;
let visiblePrivate!: Awaited<ReturnType<typeof createIssue>>;
let doneStateId!: string;

const by = () => ({ id: colleague.id, name: colleague.name });

beforeAll(async () => {
  me = await mkUser({ name: "工作台主人" });
  colleague = await mkUser({ name: "创作同事" });
  ws = await mkWorkspace(colleague.id);
  await addMember(ws.id, me.id, "MEMBER");
  pub = await mkProject(ws.id, colleague.id);
  priv = await mkProject(ws.id, colleague.id, { isPrivate: true });
  // 指派护栏（assertUsersVisible）：私有项目里被指派人必须是项目成员
  await prisma.projectMember.create({
    data: { projectId: priv.id, userId: me.id, role: "MEMBER" },
  });

  doneStateId = (await listStates(pub.id)).find((s) => s.group === "COMPLETED")!.id;

  assignedOpen = await createIssue(pub.id, { title: "待我处理", assigneeIds: [me.id] }, by());
  assignedDone = await createIssue(pub.id, { title: "已完成的指派", assigneeIds: [me.id] }, by());
  await updateIssue(pub.id, assignedDone.number, { stateId: doneStateId }, by());
  // createdMine：以 me 为创建者建号（先指派再清掉，让 assigned/created 两个维度正交）
  createdMine = await createIssue(pub.id, { title: "我创建", assigneeIds: [me.id] }, { id: me.id, name: me.name });
  await updateIssue(pub.id, createdMine.number, { assigneeIds: [] }, { id: me.id, name: me.name });
  visiblePrivate = await createIssue(priv.id, { title: "私有项目指派", assigneeIds: [me.id] }, by());
});

afterAll(cleanupFixtures);

describe("assigned tab", () => {
  it("开放态语义：COMPLETED 组不进「待我处理」；私有项目成员的指派可见", async () => {
    const r = await getWorkbench(me.id, "assigned");
    const ids = r.issues.map((i) => i.id);
    expect(ids).toContain(assignedOpen.id);
    expect(ids).not.toContain(assignedDone.id); // 完成态排除
    expect(ids).toContain(visiblePrivate.id); // ProjectMember ∪ 公开项目 并集语义
    expect(r.stats.assigned).toBe(2); // assignedOpen + visiblePrivate
  });

  it("created tab 统计我创建的；由同事创建的私有 issue 只进创建者自己的视图", async () => {
    const mine = await getWorkbench(me.id, "created");
    expect(mine.issues.some((i) => i.id === createdMine.id)).toBe(true);
    expect(mine.stats.created).toBe(1);

    // 同事是 OWNER：自己创建的私有项目 issue 在其 created 视图可见
    const theirs = await getWorkbench(colleague.id, "created");
    expect(theirs.issues.some((i) => i.id === visiblePrivate.id)).toBe(true);
  });

  it("归档的 issue 不进工作台", async () => {
    const archived = await createIssue(pub.id, { title: "归档走开", assigneeIds: [me.id] }, by());
    await updateIssue(pub.id, archived.number, { isArchived: true }, by());
    const r = await getWorkbench(me.id, "assigned");
    expect(r.issues.some((i) => i.id === archived.id)).toBe(false);
  });

  it("wsSlug 收窄：已知工作区生效；未知 slug 返回空集（不泄露存在性）", async () => {
    const narrowed = await getWorkbench(me.id, "assigned", undefined, ws.slug);
    expect(narrowed.issues.some((i) => i.id === assignedOpen.id)).toBe(true);
    const ghost = await getWorkbench(me.id, "assigned", undefined, "no-such-ws");
    expect(ghost.issues).toEqual([]);
    expect(ghost.stats).toEqual({ assigned: 0, created: 0 });
  });

  it("无任何工作区时静默空转", async () => {
    const loner = await mkUser({ name: "无组人员" });
    const r = await getWorkbench(loner.id, "assigned");
    expect(r.issues).toEqual([]);
    expect(r.stats).toEqual({ assigned: 0, created: 0 });
    expect(r.hasMore).toBe(false);
    expect(r.nextCursor).toBeNull();
  });
});

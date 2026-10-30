// vi.mock 必须悬置于 import 之前（vitest 会提升到文件顶部）：隔离 IM 队列，
// 避免测试把站内推送 job 留在真实队列里（dispatchIm 本就是尽力而为的旁路）
vi.mock("@/server/queue", () => ({
  IM_SEND_QUEUE: "notifications.im.send",
  getBoss: () => Promise.resolve({ send: async () => {} }),
}));

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createIssue } from "@/server/services/issue";
import { updateProject } from "@/server/services/project";
import { searchEverywhere } from "@/server/services/search";
import { addMember, cleanupFixtures, mkProject, mkUser, mkWorkspace, uid } from "./helpers";

// searchEverywhere（/api/search 单源）：issue 标题/描述 + 项目名双分组、
// 私有项目可见性、归档排除、q 为空时项目组为空、空成员空集。
// 协议层语义（422/scope/响应包装）由 verify-agent 脚本与 scopes 单测背书。

let owner!: Awaited<ReturnType<typeof mkUser>>;
let outsider!: Awaited<ReturnType<typeof mkUser>>;
let privMember!: Awaited<ReturnType<typeof mkUser>>;
let ws!: Awaited<ReturnType<typeof mkWorkspace>>;
let mobile!: Awaited<ReturnType<typeof mkProject>>;
let priv!: Awaited<ReturnType<typeof mkProject>>;
let issueKeyword!: string;
let mobileKeyword!: string;
let privKeyword!: string;
const actor = () => ({ id: owner.id, name: owner.name });

beforeAll(async () => {
  owner = await mkUser({ name: "搜索者" });
  outsider = await mkUser({ name: "非项目成员" });
  privMember = await mkUser({ name: "私有项目成员" });
  ws = await mkWorkspace(owner.id);
  await addMember(ws.id, outsider.id, "MEMBER");
  await addMember(ws.id, privMember.id, "MEMBER");

  mobileKeyword = uid("v");
  // 复现用户报告场景：项目名含中文（“移动端App”），检索其片段应命中项目组
  mobile = await mkProject(ws.id, owner.id, {
    name: `移动端App MobileHub ${mobileKeyword}`,
  });
  privKeyword = uid("v");
  priv = await mkProject(ws.id, owner.id, {
    name: `机密计划 ${privKeyword}`,
    isPrivate: true,
  });
  await prisma.projectMember.create({
    data: { projectId: priv.id, userId: privMember.id, role: "MEMBER" },
  });

  issueKeyword = uid("v");
  await createIssue(mobile.id, { title: `集成搜索命中 ${issueKeyword}` }, actor());
});

afterAll(cleanupFixtures);

describe("全局搜索：项目名检索", () => {
  it("项目名片段命中 → projects 组带项目页深链，issue 不误命中", async () => {
    const r = await searchEverywhere(owner.id, { q: mobileKeyword, customFilters: {} });
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toMatchObject({
      id: mobile.id,
      name: `移动端App MobileHub ${mobileKeyword}`,
    });
    expect(r.projects[0].url).toBe(`/w/${ws.slug}/p/${mobile.slug}`);
    expect(r.issues).toEqual([]);
  });

  it("中文片段与大小写不敏感：搜“移动端App”与小写 mobilehub 均命中", async () => {
    for (const q of ["移动端App", `mobilehub ${mobileKeyword}`.toLowerCase()]) {
      const r = await searchEverywhere(owner.id, { q, customFilters: {} });
      expect(r.projects.some((p) => p.id === mobile.id)).toBe(true);
    }
  });

  it("issue 标题关键词命中 → issues 组带 SLUG-N ref 与深链，项目组不受影响", async () => {
    const r = await searchEverywhere(owner.id, { q: issueKeyword, customFilters: {} });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({
      number: expect.any(Number),
      title: `集成搜索命中 ${issueKeyword}`,
    });
    expect(r.issues[0].ref).toBe(`${mobile.slug.toUpperCase()}-${r.issues[0].number}`);
    expect(r.issues[0].url).toBe(
      `/w/${ws.slug}/p/${mobile.slug}/issues/${r.issues[0].number}`,
    );
    expect(r.projects).toEqual([]);
  });

  it("私有项目：非项目成员不可见，项目成员与工作区 OWNER 可见", async () => {
    const rOutsider = await searchEverywhere(outsider.id, { q: privKeyword, customFilters: {} });
    expect(rOutsider.projects).toEqual([]);
    for (const who of [privMember, owner]) {
      const r = await searchEverywhere(who.id, { q: privKeyword, customFilters: {} });
      expect(r.projects.some((p) => p.id === priv.id)).toBe(true);
    }
  });

  it("归档项目不参与检索", async () => {
    await updateProject(mobile.id, { isArchived: true });
    const r = await searchEverywhere(owner.id, { q: mobileKeyword, customFilters: {} });
    expect(r.projects).toEqual([]);
    await updateProject(mobile.id, { isArchived: false });
  });
});

describe("全局搜索：边界形态", () => {
  it("q 为空（纯字段检索）→ 项目组恒为空数组，字段过滤仅作用于 issue", async () => {
    const r = await searchEverywhere(owner.id, { q: "", customFilters: { 无此键: "x" } });
    expect(r.projects).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.appliedCustomFilters).toEqual({ 无此键: "x" });
    expect(r.matchedFieldProjects).toEqual([]);
  });

  it("无任何工作区成员关系 → 空集不报错", async () => {
    const loner = await mkUser({ name: "孤立用户" });
    const r = await searchEverywhere(loner.id, { q: mobileKeyword, customFilters: {} });
    expect(r.projects).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});

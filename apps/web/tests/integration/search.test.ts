// vi.mock 必须悬置于 import 之前（vitest 会提升到文件顶部）：隔离 IM 队列，
// 避免测试把站内推送 job 留在真实队列里（dispatchIm 本就是尽力而为的旁路）
vi.mock("@/server/queue", () => ({
  IM_SEND_QUEUE: "notifications.im.send",
  getBoss: () => Promise.resolve({ send: async () => {} }),
}));

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createIssue } from "@/server/services/issue";
import { createCustomField } from "@/server/services/custom-field";
import { updateProject } from "@/server/services/project";
import { searchEverywhere } from "@/server/services/search";
import { addMember, cleanupFixtures, mkProject, mkUser, mkWorkspace, uid } from "./helpers";

// searchEverywhere（/api/search 单源）：issue 描述正文 + 项目名双分组、
// 私有项目可见性、归档项目不进项目名组（issue 侧仅排除 issue 级归档，归档项目的
// 正文命中仍返回——与工作台聚合同口径）、q 为空时项目组为空、空成员空集、
// 截断上限与排序（issue 20 / 项目 5，倒序取新）、跨项目字段过滤（仅 SELECT 可检索）。
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
  await createIssue(mobile.id, { descriptionText: `集成搜索命中 ${issueKeyword}` }, actor());
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

  it("issue 正文关键词命中 → issues 组带 SLUG-N ref、首行摘要与深链，项目组不受影响", async () => {
    const r = await searchEverywhere(owner.id, { q: issueKeyword, customFilters: {} });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({
      number: expect.any(Number),
      summary: `集成搜索命中 ${issueKeyword}`,
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

  it("归档项目不进项目名检索组；其 issue 仍可被正文命中（与工作台聚合同口径）", async () => {
    await updateProject(mobile.id, { isArchived: true });
    const r = await searchEverywhere(owner.id, { q: mobileKeyword, customFilters: {} });
    expect(r.projects).toEqual([]);
    // issue 侧的归档排除只落在 issue 级 isArchived：归档项目的正文命中照常返回
    const r2 = await searchEverywhere(owner.id, { q: issueKeyword, customFilters: {} });
    expect(r2.issues).toHaveLength(1);
    expect(r2.issues[0].project.id).toBe(mobile.id);
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

describe("全局搜索：截断与排序口径（issue 20 / 项目 5，倒序取新）", () => {
  it("issue 命中超上限截到 20 条，updatedAt 倒序——创建最早的两条先被截掉", async () => {
    const kw = uid("v");
    const numbers: number[] = [];
    for (let i = 0; i < 22; i++) {
      const it = await createIssue(mobile.id, { descriptionText: `截断锚 ${kw} 第${i}号` }, actor());
      numbers.push(it.number);
    }
    // 显式离散化 updatedAt：@updatedAt 是毫秒精度，同一毫秒内并列会让 take:20 的
    // 边界取舍与并列序不确定——精确序断言需要确定性时间戳，不赌事务耗时
    const base = Date.now();
    for (let i = 0; i < numbers.length; i++) {
      await prisma.issue.update({
        where: { projectId_number: { projectId: mobile.id, number: numbers[i] } },
        data: { updatedAt: new Date(base + i * 1000) },
      });
    }
    const r = await searchEverywhere(owner.id, { q: kw, customFilters: {} });
    expect(r.issues).toHaveLength(20);
    // 双锚：只返回 20 条（上限），且返回序与「createdAt 序的倒序」一致（排序方向）
    expect(r.issues.map((h) => h.number)).toEqual(numbers.slice(2).reverse());
  });

  it("项目名命中超上限截到 5 条，createdAt 倒序——创建最早的被截掉", async () => {
    const kw = uid("v");
    const created: string[] = [];
    for (let i = 0; i < 6; i++) {
      created.push((await mkProject(ws.id, owner.id, { name: `截断项目 ${kw} ${i}` })).id);
    }
    // 同上：显式离散化 createdAt，消除同毫秒并列的边界不确定性
    const base = Date.now();
    for (let i = 0; i < created.length; i++) {
      await prisma.project.update({
        where: { id: created[i] },
        data: { createdAt: new Date(base + i * 1000) },
      });
    }
    const r = await searchEverywhere(owner.id, { q: kw, customFilters: {} });
    expect(r.projects).toHaveLength(5);
    const ids = r.projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(created.slice(1)));
    expect(ids).not.toContain(created[0]);
  });
});

describe("全局搜索：跨项目自定义字段过滤（仅 SELECT 可检索，此前仅验收脚本背书）", () => {
  it("单选等值命中：回显 appliedCustomFilters、matchedFieldProjects 带发现入口、响应携带 fieldValues", async () => {
    const p = await mkProject(ws.id, owner.id);
    await createCustomField(
      p.id,
      {
        key: "sev",
        name: "严重度",
        type: "SELECT",
        options: [
          { value: "s1", label: "S1" },
          { value: "s2", label: "S2" },
        ],
      },
      { id: owner.id },
    );
    const hit = await createIssue(p.id, { descriptionText: "字段命中", fieldValues: { sev: "s1" } }, actor());
    const miss = await createIssue(p.id, { descriptionText: "字段未命中", fieldValues: { sev: "s2" } }, actor());
    const r = await searchEverywhere(owner.id, { q: "", customFilters: { sev: "s1" } });
    expect(r.appliedCustomFilters).toEqual({ sev: "s1" });
    expect(r.matchedFieldProjects).toEqual([
      { projectId: p.id, schemaUrl: `/api/projects/${p.id}/fields/schema` },
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].id).toBe(hit.id);
    expect(r.issues[0].fieldValues).toEqual({ sev: "s1" });
    expect(r.issues.some((h) => h.id === miss.id)).toBe(false);
    expect(r.projects).toEqual([]); // 纯字段检索（q 空）项目组恒空
  });

  it("过滤键未被项目完整定义 → 整组排除不产模糊命中；多选为包含语义", async () => {
    const p = await mkProject(ws.id, owner.id);
    await createCustomField(
      p.id,
      { key: "sev2", name: "严重度", type: "SELECT", options: [{ value: "s1", label: "S1" }] },
      { id: owner.id },
    );
    // p 只定义了 sev2、没定义 other2 → 「全部过滤键都被定义」不成立，整组排除
    const r = await searchEverywhere(owner.id, { q: "", customFilters: { sev2: "s1", other2: "x" } });
    expect(r.matchedFieldProjects).toEqual([]);
    expect(r.issues).toEqual([]);

    const pm = await mkProject(ws.id, owner.id);
    await createCustomField(
      pm.id,
      {
        key: "tags",
        name: "标签",
        type: "SELECT",
        settings: { multiple: true },
        options: [
          { value: "t1", label: "T1" },
          { value: "t2", label: "T2" },
        ],
      },
      { id: owner.id },
    );
    const multi = await createIssue(
      pm.id,
      { descriptionText: "多选命中", fieldValues: { tags: ["t1", "t2"] } },
      actor(),
    );
    const r2 = await searchEverywhere(owner.id, { q: "", customFilters: { tags: "t1" } });
    expect(r2.matchedFieldProjects).toEqual([
      { projectId: pm.id, schemaUrl: `/api/projects/${pm.id}/fields/schema` },
    ]);
    expect(r2.issues).toHaveLength(1);
    expect(r2.issues[0].id).toBe(multi.id);
  });
});

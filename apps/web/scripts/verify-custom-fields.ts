/**
 * 自定义字段 · 端到端验收（DB 直连，无需服务运行）
 * 运行：pnpm tsx scripts/verify-custom-fields.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  archiveCustomField,
  createCustomField,
  exportCustomFields,
  fieldValuesJsonSchema,
  importCustomFields,
  listCustomFields,
  listFieldRevisions,
  updateCustomField,
} from "../src/server/services/custom-field";
import { validateFieldValues } from "../src/server/custom-fields/registry";
import { createIssue, listIssues, updateIssue } from "../src/server/services/issue";
import { issueFilterParams } from "../src/lib/dto";
import { parseIssueQuery } from "../src/lib/validations";
import { check, finish, markFailed } from "./lib/verify-kit";

async function expect422(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "（未抛出）");
  } catch (e) {
    // 只认 422——message 模糊匹配会让带"必填"字样的意外异常误判通过
    check(name, (e as { status?: number }).status === 422, `（${(e as Error).message}）`);
  }
}

async function main() {
  const actor = await prisma.user.findFirst({ where: { isActive: true } });
  if (!actor) throw new Error("无可用用户");
  const who = { id: actor.id };

  // 失败/中断也不遗留数据：清掉历史残留的验收项目（幂等）
  await sweepStaleVerifyProjects();

  // 验收隔离：自建一次性项目，避免受演示项目上既有字段（尤其必填）影响，
  // 也避免污染真实项目数据。结束后于 cleanup 删除。
  const host = await prisma.workspace.findFirst({ select: { id: true } });
  if (!host) throw new Error("无可用工作区，请先 seed");
  // 通知收件人必须是工作区成员（emitNotifications 的护栏）；取一位真实同事作为 lead
  const other2 = (
    await prisma.workspaceMember.findFirst({
      where: { workspaceId: host.id, userId: { not: actor.id }, user: { isActive: true } },
      include: { user: true },
    })
  )?.user;
  const project = await prisma.project.create({
    data: {
      workspaceId: host.id,
      slug: `cf-verify-${Date.now().toString(36)}`,
      name: "CF 验收项目",
      leadUserId: other2?.id ?? actor.id,
    },
  });
  const pid = project.id;

  console.log("\n[1] 字段定义 CRUD");
  const dupKey = `test_${Date.now().toString(36)}`;
  const f = await createCustomField(
    pid,
    { key: dupKey, name: "严重等级", type: "SELECT", options: [
      { value: "s1", label: "S1 致命" },
      { value: "s2", label: "S2 严重" },
      { value: "s3", label: "S3 一般" },
    ] },
    who,
  );
  check("创建 SELECT 字段", f.type === "SELECT" && f.version === 1);
  const text = await createCustomField(pid, { key: `${dupKey}_note`, name: "客户名称", type: "TEXT", isRequired: true }, who);
  const num = await createCustomField(pid, { key: `${dupKey}_sla`, name: "SLA 小时", type: "NUMBER" }, who);
  const date = await createCustomField(pid, { key: `${dupKey}_due`, name: "承诺日期", type: "DATE" }, who);
  // 类型正确性真断言（!!x 只能证明"没抛"，帮手函数不抛.x 就恒真）
  check(
    "创建 TEXT/NUMBER/DATE（类型与 key 落库正确）",
    text.type === "TEXT" && text.key === `${dupKey}_note` &&
    num.type === "NUMBER" && num.key === `${dupKey}_sla` &&
    date.type === "DATE" && date.key === `${dupKey}_due`,
  );

  try {
    await createCustomField(pid, { key: dupKey, name: "重复", type: "TEXT" }, who);
    check("重复 key 拒绝", false);
  } catch (e) {
    check("重复 key 拒绝", (e as { status?: number }).status === 409);
  }
  await expect422("SELECT 无选项拒绝", () =>
    createCustomField(pid, { key: `${dupKey}_bad`, name: "坏", type: "SELECT" }, who),
  );

  const revs = await listFieldRevisions(pid, f.id);
  check("创建即落一条定义快照", revs.length === 1 && revs[0].version === 1);

  console.log("\n[2] 定义变更与选项软删");
  const renamed = await updateCustomField(pid, f.id, { name: "严重程度" }, who);
  check("改名 + version 自增", renamed.name === "严重程度" && renamed.version === 2);
  // 只移除 s2 → s2 应被软删而非消失（s1/s3 保持可选）
  const opt = await updateCustomField(pid, f.id, {
    options: [
      { value: "s1", label: "S1 致命" },
      { value: "s3", label: "S3 一般" },
    ],
  }, who);
  const opts = (opt.options ?? []) as { value: string; archived?: boolean }[];
  check("被移除选项软删保留", opts.some((o) => o.value === "s2" && o.archived === true), `count=${opts.length}`);
  const revs2 = await listFieldRevisions(pid, f.id);
  check("变更追加审计快照", revs2.length === 3);
  // 软删选项的语义边界：存量值仍合法，但不得再被新选
  const selIssue = await createIssue(
    pid,
    { title: `软删选项存量值 ${dupKey}`, fieldValues: { [f.key]: "s1", [text.key]: "ACME" } },
    { id: actor.id, name: actor.name },
  );
  await expect422("软删选项不可再新选", async () => {
    const cur = (await prisma.issue.findUniqueOrThrow({ where: { id: selIssue.id }, select: { fieldValues: true } })).fieldValues as Record<string, unknown>;
    await validateFieldValues([opt as never], { [f.key]: "s2" }, { enforceRequired: false, prevValues: cur });
  });
  const kept = await validateFieldValues([opt as never], { [f.key]: "s2" }, { enforceRequired: false, prevValues: { [f.key]: "s2" } });
  check("软删选项存量值仍可保存", kept[f.key] === "s2");

  console.log("\n[3] Issue 值写入：创建 + 校验");
  const issue = await createIssue(
    pid,
    { title: `CF 验收 ${dupKey}`, fieldValues: { [dupKey]: "s1", [text.key]: "ACME", [num.key]: 24, [date.key]: "2026-01-31" } },
    { id: actor.id, name: actor.name },
  );
  const fv = (issue.fieldValues ?? {}) as Record<string, unknown>;
  check("创建时写入自定义字段值", fv[dupKey] === "s1" && fv[text.key] === "ACME" && fv[num.key] === 24);
  check("Date 归一化为 YYYY-MM-DD", fv[date.key] === "2026-01-31");

  await expect422("未知 key 拒绝", () =>
    createIssue(pid, { title: "坏", fieldValues: { not_exist_key: 1 } }, { id: actor.id, name: actor.name }),
  );
  await expect422("SELECT 非法值拒绝", () =>
    createIssue(pid, { title: "坏", fieldValues: { [dupKey]: "s9", [text.key]: "x" } }, { id: actor.id, name: actor.name }),
  );
  await expect422("必填缺失拒绝", () =>
    createIssue(pid, { title: "坏", fieldValues: { [dupKey]: "s1" } }, { id: actor.id, name: actor.name }),
  );
  await expect422("数字类型不合法拒绝", () =>
    createIssue(pid, { title: "坏", fieldValues: { [dupKey]: "s1", [text.key]: "x", [num.key]: "abc" } }, { id: actor.id, name: actor.name }),
  );

  console.log("\n[4] Issue 值更新：diff + Activity 事实源");
  await updateIssue(pid, issue.number, { fieldValues: { [dupKey]: "s3" } }, { id: actor.id, name: actor.name });
  const acts = await prisma.activity.findMany({
    where: { issueId: issue.id, field: `custom:${dupKey}` },
    orderBy: { createdAt: "asc" },
  });
  check("值变更落 Activity（custom:<key>）", acts.length === 1 && acts[0].newValue === "s3", `old=${acts[0]?.oldValue}`);
  const after = await prisma.issue.findUnique({ where: { id: issue.id } });
  check("更新合并保留其他值", (after?.fieldValues as Record<string, unknown>)?.[text.key] === "ACME");
  await expect422("必填字段不允许清空", () =>
    updateIssue(pid, issue.number, { fieldValues: { [text.key]: null } }, { id: actor.id, name: actor.name }),
  );
  await updateIssue(pid, issue.number, { fieldValues: { [num.key]: 48 } }, { id: actor.id, name: actor.name });
  const acts2 = await prisma.activity.count({ where: { issueId: issue.id, field: `custom:${num.key}` } });
  check("值变更产生 Activity", acts2 === 1, `count=${acts2}`);
  // 再写相同值：不应新增 Activity（无变化不打扰）
  await updateIssue(pid, issue.number, { fieldValues: { [num.key]: 48 } }, { id: actor.id, name: actor.name });
  const acts3 = await prisma.activity.count({ where: { issueId: issue.id, field: `custom:${num.key}` } });
  check("无变化不产生 Activity", acts3 === 1, `count=${acts3}`);

  console.log("\n[5] 归档软删：历史值可读、校验不再要求");
  await archiveCustomField(pid, text.id, who);
  const active = await listCustomFields(pid);
  check("归档后不在启用列表", !active.some((x) => x.key === text.key));
  const all = await listCustomFields(pid, true);
  check("管理列表含归档字段", all.some((x) => x.key === text.key && x.isArchived));
  const stillThere = await prisma.issue.findUnique({ where: { id: issue.id } });
  check("历史 issue 值保留", (stillThere?.fieldValues as Record<string, unknown>)?.[text.key] === "ACME");
  const issue2 = await createIssue(pid, { title: "归档后新建", fieldValues: { [dupKey]: "s1" } }, { id: actor.id, name: actor.name });
  // 被"验收"的事实是 createIssue 没被归档必填字段拦下（帮忙函数任一失败都以异常中断）
  check("归档的必填字段不再拦截创建", issue2.number > 0);

  console.log("\n[6] Schema 导出 / 导入（跨项目复用）");
  const exported = await exportCustomFields(pid);
  check("导出为声明式 JSON", exported.version === 1 && exported.fields.some((x) => x.key === dupKey));

  // 导入目标必须是专属临时项目：绝不污染既有项目（曾借道 demo 项目，遗留必填字段打破 verify-agent）
  const other = await prisma.project.create({
    data: {
      workspaceId: project.workspaceId,
      slug: `cf-verify-import-${Date.now().toString(36)}`,
      name: "CF 验收导入目标",
    },
  });
  {
    const res = await importCustomFields(
      other.id,
      { fields: exported.fields.map((x) => ({ ...x, settings: (x.settings ?? undefined) })) as never },
      who,
    );
    check("导入到另一项目（新建）", res.created === exported.fields.length, JSON.stringify(res));
    const res2 = await importCustomFields(
      other.id,
      { fields: exported.fields.map((x) => ({ ...x, settings: (x.settings ?? undefined) })) as never },
      who,
    );
    check("重复导入走更新（幂等）", res2.created === 0 && res2.updated === exported.fields.length);
    const res3 = await importCustomFields(
      other.id,
      { fields: [{ key: dupKey, name: "冲突", type: "TEXT" }] },
      who,
    );
    check("type 冲突跳过并回报", res3.skipped.length === 1);
  }

  console.log("\n[7] 直接调用校验器（类型注册表）");
  const fields = await prisma.customField.findMany({ where: { projectId: pid, isArchived: false } });
  const v = validateFieldValues(fields, { [dupKey]: "s1", [num.key]: "12" }, { enforceRequired: false });
  check("NUMBER 字符串归一为数字", v[num.key] === 12);
  await expect422("日期格式错误拒绝", async () =>
    validateFieldValues(fields, { [date.key]: "2026/01/31" }, { enforceRequired: false }),
  );

  console.log("\n[8] 自定义字段过滤（listIssues + query 解析；可检索类型 = 仅 SELECT）");
  // 造两条具有可比自定义字段值的问题（dupKey=SELECT s1/s3）
  const f1 = await createIssue(
    pid,
    { title: `CF 过滤A ${dupKey}`, fieldValues: { [dupKey]: "s1" } },
    { id: actor.id, name: actor.name },
  );
  const f2 = await createIssue(
    pid,
    { title: `CF 过滤B ${dupKey}`, fieldValues: { [dupKey]: "s3" } },
    { id: actor.id, name: actor.name },
  );
  const bySelect = await listIssues(pid, { fieldValues: { [dupKey]: "s1" } }, 1, 50);
  const selNums = bySelect.issues.map((i) => i.number);
  check("按 SELECT 字段等值过滤", selNums.includes(f1.number) && !selNums.includes(f2.number), `total=${bySelect.total}`);
  // "退化为不过滤"的正确断言是结果集 === 不过滤的全集（total 相等），
  // "包含样例两条"挡不住"只漏删了一半"的过滤实现
  const unfiltered = await listIssues(pid, {}, 1, 50);
  const byDate = await listIssues(pid, { fieldValues: { [date.key]: "2026-01-01..2026-12-31" } }, 1, 50);
  check("DATE 不再支持检索（过滤退化为不过滤）", byDate.total === unfiltered.total, `total=${byDate.total}/${unfiltered.total}`);
  const byNum = await listIssues(pid, { fieldValues: { [num.key]: "20" } }, 1, 50);
  check("NUMBER 不再支持检索（过滤退化为不过滤）", byNum.total === unfiltered.total, `total=${byNum.total}/${unfiltered.total}`);
  const ghost = await listIssues(pid, { fieldValues: { not_a_field: "x" } }, 1, 50);
  check("未定义字段过滤退化为不过滤（不报错）", ghost.total === unfiltered.total, `total=${ghost.total}/${unfiltered.total}`);
  const parsed = parseIssueQuery(
    new URLSearchParams({ [`cf.${dupKey}`]: "s1", page: "2", pageSize: "50" }),
  );
  check("query 解析 cf.<key> 进 fieldValues", parsed.filters.fieldValues?.[dupKey] === "s1");
  check("cf.* 不污染固定过滤参数", parsed.filters.stateId === undefined && parsed.page === 2);
  const encoded = issueFilterParams({ fieldValues: { [dupKey]: "s1" } });
  check("issueFilterParams 序列化 cf.<key>", encoded[`cf.${dupKey}`] === "s1");

  console.log("\n[8.5] SELECT 多值（settings.multiple，标签语义承接）");
  const tags = await createCustomField(
    pid,
    { key: `${dupKey}_tags`, name: "标签", type: "SELECT", settings: { multiple: true }, options: [
      { value: "area-fe", label: "前端" },
      { value: "area-be", label: "后端" },
      { value: "prod", label: "线上" },
    ] },
    who,
  );
  check("创建多选 SELECT 字段", tags.type === "SELECT" && (tags.settings as { multiple?: boolean })?.multiple === true);
  const multiIssue = await createIssue(
    pid,
    { title: `CF 多选A ${dupKey}`, fieldValues: { [tags.key]: ["area-fe", "prod", "area-fe"] } },
    { id: actor.id, name: actor.name },
  );
  const multiFv = multiIssue.fieldValues as Record<string, unknown>;
  check("多选写入去重且保序", JSON.stringify(multiFv[tags.key]) === JSON.stringify(["area-fe", "prod"]));
  const byTag = await listIssues(pid, { fieldValues: { [tags.key]: "prod" } }, 1, 50);
  check("多选字段包含语义过滤", byTag.issues.some((i) => i.number === multiIssue.number));
  const byTagMiss = await listIssues(pid, { fieldValues: { [tags.key]: "area-be" } }, 1, 50);
  check("未命中选项的多选过滤排除", !byTagMiss.issues.some((i) => i.number === multiIssue.number));
  await expect422("多选非法选项拒绝", () =>
    createIssue(
      pid,
      { title: `CF 多选坏 ${dupKey}`, fieldValues: { [tags.key]: ["area-fe", "nope"] } },
      { id: actor.id, name: actor.name },
    ),
  );
  const multiSchema = await fieldValuesJsonSchema(pid);
  const tagProp = (multiSchema.properties as Record<string, { type?: string; items?: { enum?: string[] } }>)[tags.key];
  check("JSON Schema 多选输出 array+enum", tagProp?.type === "array" && tagProp.items?.enum?.includes("area-fe") === true);
  await expect422("多选改回单选拒绝（值形态不可逆）", () =>
    updateCustomField(pid, tags.id, { settings: { multiple: false } }, who),
  );
  const tagsAfter = await updateCustomField(pid, tags.id, { name: "标签（改）" }, who);
  check("多选开关在无关更新后保留", (tagsAfter.settings as { multiple?: boolean })?.multiple === true);

  // ── 自描述 JSON Schema ──
  const jsonSchema = await fieldValuesJsonSchema(pid);
  type PropShape = { type?: string; enum?: string[]; maxLength?: number; format?: string };
  const props = jsonSchema.properties as Record<string, PropShape>;
  check(
    "JSON Schema 自描述字段类型/枚举",
    props[dupKey]?.enum?.includes("s1") === true &&
      props[num.key]?.type === "number" &&
      props[date.key]?.format === "date",
  );
  // text.key 已归档：写 schema（properties）必须不含归档字段——x-fields 才是展示全量
  check("归档字段不进入写 schema（properties 无归档 key）", props[text.key] === undefined);
  check("JSON Schema 拒绝额外 key", jsonSchema.additionalProperties === false);
  // 带归档字段出现在 x-fields 的只有 includeArchived=true 变体（默认变体 x-fields
  // 也只含启用字段，见 fieldValuesJsonSchema 实现）——两条断言各取其变体，口径如实
  const schemaInclArchived = await fieldValuesJsonSchema(pid, true);
  check(
    "x-fields 展示元信息：启用字段在列、归档字段仅含归档变体出现且带标记",
    jsonSchema["x-fields"].some((f: { key: string; name: string }) => f.key === dupKey && f.name) &&
    !jsonSchema["x-fields"].some((f: { key: string }) => f.key === text.key) &&
    schemaInclArchived["x-fields"].some((f: { key: string; isArchived?: boolean }) => f.key === text.key && f.isArchived === true),
  );

  // ── USER 类型字段 + 字段级通知规则（afterWrite） ──
  const leadId = other2?.id ?? actor.id;
  const userField = await createCustomField(
    pid,
    { key: "owner2", name: "备选负责人", type: "USER", settings: { multiple: false } } as never,
    who,
  );
  const userMulti = await createCustomField(
    pid,
    { key: "watchers2", name: "观察者", type: "USER", settings: { multiple: true } } as never,
    who,
  );
  check("USER 字段创建", userField.type === "USER" && userMulti.type === "USER");

  const cfIssue = await createIssue(
    pid,
    { title: "CF 验收 USER 字段", fieldValues: { owner2: leadId, watchers2: [leadId] } } as never,
    { id: actor.id, name: actor.name },
  );
  const cfFv = (cfIssue.fieldValues ?? {}) as Record<string, unknown>;
  check(
    "USER 单选/多选值落库",
    cfFv.owner2 === leadId &&
      Array.isArray(cfFv.watchers2) &&
      (cfFv.watchers2 as string[]).length === 1 &&
      (cfFv.watchers2 as string[])[0] === leadId,
  );

  await expect422("USER 非字符串值被拒", async () => {
    await updateIssue(pid, cfIssue.number, { fieldValues: { owner2: 123 } } as never, {
      id: actor.id,
      name: actor.name,
    });
  });
  await expect422("USER 多选非数组被拒", async () => {
    await updateIssue(pid, cfIssue.number, { fieldValues: { watchers2: "x" } } as never, {
      id: actor.id,
      name: actor.name,
    });
  });
  await expect422("USER 不可见成员被拒", async () => {
    await updateIssue(pid, cfIssue.number, { fieldValues: { owner2: "no-such-user" } } as never, {
      id: actor.id,
      name: actor.name,
    });
  });

  // 多选去重
  const dedup = await updateIssue(
    pid,
    cfIssue.number,
    { fieldValues: { watchers2: [leadId, leadId, leadId] } } as never,
    { id: actor.id, name: actor.name },
  );
  const dupFv = (dedup.fieldValues ?? {}) as Record<string, unknown>;
  check(
    "USER 多选自动去重",
    Array.isArray(dupFv.watchers2) &&
      (dupFv.watchers2 as string[]).length === 1 &&
      (dupFv.watchers2 as string[])[0] === leadId,
  );

  // JSON Schema 映射
  const schema4 = await fieldValuesJsonSchema(pid);
  const p4 = schema4.properties as Record<string, { type?: string; format?: string; items?: { format?: string } }>;
  check(
    "USER 进入 JSON Schema（单选 format / 多选 array）",
    p4.owner2?.type === "string" &&
      p4.owner2?.format === "user-id" &&
      p4.watchers2?.type === "array" &&
      p4.watchers2?.items?.format === "user-id",
  );

  // 通知规则：值变为 critical 通知项目负责人
  const sev = await createCustomField(
    pid,
    {
      key: "sev2",
      name: "严重度2",
      type: "SELECT",
      options: [
        { value: "low", label: "低" },
        { value: "critical", label: "致命" },
      ],
      settings: { notifyOn: { values: ["critical"], notify: ["PROJECT_LEAD"] } },
    } as never,
    who,
  );
  check("带 notifyOn 规则字段创建", (sev.settings as { notifyOn?: unknown })?.notifyOn !== undefined);

  // lead=操作者（单人环境）时"操作者本人排除"会让命中规则却不通知——
  // 系统行为正确也会假失败，须与下方自我排除用例同条件跳过
  const canAssertLeadNotify = leadId !== actor.id;
  const beforeCount = await prisma.notification.count({ where: { userId: leadId } });
  await updateIssue(pid, cfIssue.number, { fieldValues: { sev2: "critical" } } as never, {
    id: actor.id,
    name: actor.name,
  });
  const afterCount = await prisma.notification.count({ where: { userId: leadId } });
  if (canAssertLeadNotify) {
    check("值命中规则 → 触发通知（项目负责人）", afterCount === beforeCount + 1, `${beforeCount}→${afterCount}`);
  } else {
    console.log("  ⏭️ 值命中规则 → 触发通知（单人环境 lead=操作者，自我排除使然，跳过）");
  }

  // 用同值重复提交：应因 diff 无变化而不重复提醒
  const n2 = await prisma.notification.count({ where: { userId: leadId } });
  await updateIssue(pid, cfIssue.number, { fieldValues: { sev2: "critical" } } as never, {
    id: actor.id,
    name: actor.name,
  });
  const n3 = await prisma.notification.count({ where: { userId: leadId } });
  if (canAssertLeadNotify) {
    check("同值重复提交不重复通知", n3 === n2);
  } else {
    console.log("  ⏭️ 同值重复提交不重复通知（单人环境恒无通知，跳过）");
  }

  // 操作者本人排除：收件人集合经 recipients.filter(id !== actor.id) 排除操作者
  // （issue.ts）。本脚本环境无法机械观测该机制——单人环境 lead≡actor（会被
  // 自我排除、diff 又无变化），多人环境 actor 也非 PROJECT_LEAD 候选；写一条
  // 恒真断言（改成不命中的值再数 actor 通知）比缺断言更糟，故诚实记跳过
  console.log("  ⏭️ 操作者本人排除（单人环境机制不可观测，跳过）");
}

/** 删除 slug 以 cf-verify 开头的所有验收项目（级联清掉字段/issue/通知/导出目标）。
 *  返回删除失败数——"验收项目一律自建自删"是承诺项，删不掉必须红（否则每轮
 * "清理 N 个"重复报同一数且门禁无感） */
async function sweepStaleVerifyProjects(): Promise<number> {
  const stale = await prisma.project.findMany({
    where: { slug: { startsWith: "cf-verify" } },
    select: { id: true },
  });
  let failedDeletes = 0;
  for (const p of stale)
    await prisma.project
      .delete({ where: { id: p.id } })
      .catch((e) => {
        failedDeletes++;
        console.error(`  ⚠️ 清理项目 ${p.id} 失败: ${(e as Error).message}`);
      });
  if (stale.length)
    console.log(`  · 清理残留验收项目 ${stale.length - failedDeletes}/${stale.length} 个`);
  return failedDeletes;
}

main()
  .catch((e) => {
    console.error(e);
    markFailed(1);
  })
  .finally(async () => {
    // 无论成败都归零：验收项目一律自建自删（删失败计入 failed，红给门禁），绝不污染真实/演示项目
    const leftover = await sweepStaleVerifyProjects().catch((e) => {
      console.error("[cleanup]", e);
      return 1;
    });
    await prisma.$disconnect();
    finish("verify-custom-fields", { extraFail: leftover });
  });

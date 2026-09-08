import type { Prisma } from "@prisma/client";
import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { z } from "zod";
import type {
  createCustomFieldSchema,
  importCustomFieldsSchema,
  updateCustomFieldSchema,
} from "@/lib/validations";
import {
  activeSelectOptions,
  selectOrUserMultiple,
  type SelectOption,
} from "@/server/custom-fields/registry";
import { recordTranslator } from "./notification";

type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;
type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;
type ImportCustomFieldsInput = z.infer<typeof importCustomFieldsSchema>;

type Actor = { id: string };

const ORDER = [{ sequence: "asc" as const }, { key: "asc" as const }];

// ── 读 ──

/** 启用中的字段（表单/校验用）；includeArchived 用于管理页 */
export async function listCustomFields(projectId: string, includeArchived = false) {
  return prisma.customField.findMany({
    where: { projectId, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: ORDER,
  });
}

/** 项目内可用于校验的启用字段（Issue 写入路径） */
export async function activeFieldsFor(
  tx: Prisma.TransactionClient | typeof prisma,
  projectId: string,
) {
  return tx.customField.findMany({ where: { projectId, isArchived: false }, orderBy: ORDER });
}

/** 定义变更历史（轻量审计，append-only） */
export async function listFieldRevisions(projectId: string, fieldId: string) {
  await getFieldOrThrow(projectId, fieldId);
  return prisma.customFieldRevision.findMany({
    where: { customFieldId: fieldId },
    orderBy: { version: "desc" },
    take: 50,
    include: { actor: { select: { id: true, name: true } } },
  });
}

// ── 内部 ──

async function getFieldOrThrow(projectId: string, fieldId: string) {
  const field = await prisma.customField.findUnique({ where: { id: fieldId } });
  if (!field || field.projectId !== projectId) throw new HttpError(404, "errors.fieldNotFound");
  return field;
}

function assertSelectOptions(type: string, options: unknown) {
  if (type === "SELECT" && (!Array.isArray(options) || options.length === 0))
    throw new HttpError(422, "errors.selectOptionsRequired");
}

/** 归一化选项：过滤空值、去重 value、保留 archived */
function normalizeOptions(input: CreateCustomFieldInput["options"]) {
  if (!input) return undefined;
  const seen = new Set<string>();
  const out: Prisma.InputJsonValue[] = [];
  for (const o of input) {
    if (seen.has(o.value)) continue;
    seen.add(o.value);
    out.push({ value: o.value, label: o.label, ...(o.color ? { color: o.color } : {}), ...(o.archived ? { archived: true } : {}) });
  }
  return out;
}

/** 定义快照（审计表用） */
function snapshot(field: {
  key: string;
  name: string;
  type: string;
  options: unknown;
  settings?: unknown;
  isRequired: boolean;
  isArchived: boolean;
  sequence: number;
}) {
  return {
    key: field.key,
    name: field.name,
    type: field.type,
    options: field.options ?? null,
    settings: field.settings ?? null,
    isRequired: field.isRequired,
    isArchived: field.isArchived,
    sequence: field.sequence,
  } satisfies Prisma.InputJsonObject;
}

// ── 写 ──

export async function createCustomField(
  projectId: string,
  input: CreateCustomFieldInput,
  actor: Actor,
) {
  assertSelectOptions(input.type, input.options);
  const dup = await prisma.customField.findUnique({
    where: { projectId_key: { projectId, key: input.key } },
  });
  if (dup) throw new HttpError(409, "errors.fieldKeyTaken", undefined, { key: input.key });

  const options = normalizeOptions(input.options);
  return prisma.$transaction(async (tx) => {
    // 拖拽排序配套：未显式指定时动态取末位（max + GAP），不再用固定 65535——
    // 中点插值可能把字段推过任意固定值，动态末位保证新建字段永远排在最后。
    let sequence = input.sequence;
    if (sequence === undefined) {
      const last = await tx.customField.findFirst({
        where: { projectId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      sequence = (last?.sequence ?? 0) + 1024;
    }
    const field = await tx.customField.create({
      data: {
        projectId,
        key: input.key,
        name: input.name,
        type: input.type,
        options: options ?? undefined,
        settings: input.settings ?? undefined,
        isRequired: input.isRequired ?? false,
        sequence,
        createdById: actor.id,
      },
    });
    await tx.customFieldRevision.create({
      data: { customFieldId: field.id, version: field.version, snapshot: snapshot(field), actorId: actor.id },
    });
    return field;
  });
}

export async function updateCustomField(
  projectId: string,
  fieldId: string,
  input: UpdateCustomFieldInput,
  actor: Actor,
) {
  const before = await getFieldOrThrow(projectId, fieldId);
  if (before.type === "SELECT" && input.options !== undefined)
    assertSelectOptions("SELECT", normalizeOptions(input.options));

  // 多选→单选禁止：值形态（string ↔ string[]）不可逆，回退会令存量数组值无法保存。
  // UI 已定向禁用（仅允许 单→多）；此处兜住 Agent/API 直接 PATCH settings 的路径。
  if (
    input.settings !== undefined &&
    (before.settings as { multiple?: unknown } | null)?.multiple === true &&
    (input.settings as { multiple?: unknown }).multiple !== true
  ) {
    throw new HttpError(422, "errors.multipleToSingleForbidden");
  }

  const data: Prisma.CustomFieldUpdateInput = {};
  if (input.name !== undefined && input.name !== before.name) data.name = input.name;
  if (input.isRequired !== undefined && input.isRequired !== before.isRequired)
    data.isRequired = input.isRequired;
  if (input.sequence !== undefined && input.sequence !== before.sequence)
    data.sequence = input.sequence;
  if (input.settings !== undefined)
    data.settings = input.settings as Prisma.InputJsonValue;

  if (input.options !== undefined) {
    // 选项合并：新增/改 label/软删（显式 archived）。value 一旦存在即不可移除，
    // 保证存量 issue 值不失效（改 value = 删旧增新，语义上不推荐但允许）。
    const next = normalizeOptions(input.options) ?? [];
    const beforeOpts = Array.isArray(before.options) ? (before.options as unknown[]) : [];
    const nextValues = new Set(
      next.filter((o): o is Prisma.InputJsonObject => !!o && typeof o === "object" && "value" in o).map((o) => String(o.value)),
    );
    const kept = beforeOpts.filter((o) => {
      const v = (o as { value?: unknown })?.value;
      // 之前存在但本次没给的选项 -> 软删（保留 label/color 以便回显）
      return typeof v === "string" && !nextValues.has(v) ? true : false;
    });
    const softDeleted = kept.map((o) => ({ ...(o as Prisma.InputJsonObject), archived: true }));
    data.options = [...next, ...softDeleted] as Prisma.InputJsonValue;
  }

  if (Object.keys(data).length === 0) return before;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.customField.update({
      where: { id: fieldId },
      data: { ...data, version: { increment: 1 } },
    });
    await tx.customFieldRevision.create({
      data: { customFieldId: fieldId, version: updated.version, snapshot: snapshot(updated), actorId: actor.id },
    });
    return updated;
  });
}

/** 归档软删：历史 issue 值仍可读（详情页只读展示），表单不再出现 */
export async function archiveCustomField(projectId: string, fieldId: string, actor: Actor) {
  const before = await getFieldOrThrow(projectId, fieldId);
  if (before.isArchived) return before;
  return prisma.$transaction(async (tx) => {
    const field = await tx.customField.update({
      where: { id: fieldId },
      data: { isArchived: true, version: { increment: 1 } },
    });
    await tx.customFieldRevision.create({
      data: { customFieldId: fieldId, version: field.version, snapshot: snapshot(field), actorId: actor.id },
    });
    return field;
  });
}

// ── Schema 可移植：导出 / 导入（跨项目/跨环境复用，替代模板继承）──

export async function exportCustomFields(projectId: string) {
  const fields = await prisma.customField.findMany({
    where: { projectId },
    orderBy: ORDER,
  });
  return {
    version: 1 as const,
    fields: fields.map((f) => ({
      key: f.key,
      name: f.name,
      type: f.type,
      options: (Array.isArray(f.options) ? f.options : []) as SelectOption[],
      settings: f.settings ?? null,
      isRequired: f.isRequired,
      isArchived: f.isArchived,
      sequence: f.sequence,
    })),
  };
}

/**
 * 按 key upsert 导入；不删除项目已有字段（导入只做增量合并）。
 * type 冲突的已存在字段跳过（改类型会令值失去语义），并回报 skipped。
 * isArchived 随行（导出物里的归档字段导入后保持归档）；已归档字段不支持导入复活，
 * 该情形随行回报 skipped——静默复活或静默保持都是失真的。
 */
export async function importCustomFields(
  projectId: string,
  input: ImportCustomFieldsInput,
  actor: Actor,
) {
  const existing = await prisma.customField.findMany({ where: { projectId } });
  const byKey = new Map(existing.map((f) => [f.key, f]));
  let created = 0;
  let updated = 0;
  const skipped: { key: string; reason: string }[] = [];
  // skipped[].reason 走响应通道（不经 handle 出口），在此按请求 locale 渲染
  const t = await recordTranslator();

  for (const def of input.fields) {
    if (def.type === "SELECT" && (!def.options || def.options.length === 0))
      throw new HttpError(422, "errors.importFieldNeedsOptions", undefined, { key: def.key });
    const cur = byKey.get(def.key);
    if (!cur) {
      const field = await createCustomField(
        projectId,
        {
          key: def.key,
          name: def.name,
          type: def.type,
          options: def.options,
          settings: def.settings ?? undefined,
          isRequired: def.isRequired,
          sequence: def.sequence,
        },
        actor,
      );
      if (def.isArchived) await archiveCustomField(projectId, field.id, actor);
      created += 1;
      continue;
    }
    if (cur.type !== def.type) {
      skipped.push({
        key: def.key,
        reason: t("errors.importTypeMismatch", { existing: cur.type, imported: def.type }),
      });
      continue;
    }
    if (def.isArchived === false && cur.isArchived) {
      skipped.push({ key: def.key, reason: t("errors.importArchivedNoRevive") });
      continue;
    }
    await updateCustomField(
      projectId,
      cur.id,
      // settings 为 null 视为"未提供"而非"清空"——增量合并语义，不动既有 settings
      { name: def.name, options: def.options, settings: def.settings ?? undefined, isRequired: def.isRequired, sequence: def.sequence },
      actor,
    );
    if (def.isArchived && !cur.isArchived) await archiveCustomField(projectId, cur.id, actor);
    updated += 1;
  }

  return { created, updated, skipped };
}

// ── Agent 自描述 JSON Schema ──
// 目的：Agent 拿到一个端点即理解本项目全部自定义字段的语义（类型/枚举/必填），
// 无需任何外部文档。jsonSchema 用于直接喂给 LLM tool-call 的参数校验器；
// fields 提供人类/Agent 可读的展示元信息（名称/选项颜色）。

function fieldJsonSchema(field: { key: string; type: string; options: unknown; settings?: unknown }): Record<string, unknown> {
  switch (field.type) {
    case "NUMBER":
      return { type: "number", description: "数字" };
    case "DATE":
      return { type: "string", format: "date", description: "YYYY-MM-DD" };
    case "SELECT": {
      const vs = activeSelectOptions({ options: field.options } as never).map((o) => o.value);
      const base = { type: "string", enum: vs, description: "选项（enum 为合法值）" };
      const multiple = selectOrUserMultiple({ settings: field.settings });
      return multiple
        ? { type: "array", items: base, description: "多选（enum 为合法值）", uniqueItems: true }
        : base;
    }
    case "USER": {
      const multiple = selectOrUserMultiple({ settings: field.settings });
      const base = { type: "string", format: "user-id", description: "成员 userId" };
      return multiple
        ? { type: "array", items: base, description: "成员 userId 列表（多选）" }
        : base;
    }
    default:
      return { type: "string", maxLength: 2000, description: "文本" };
  }
}

/**
 * 生成 fieldValues 的 JSON Schema（draft 2020-12）+ 字段元信息。
 * includeArchived=false：只包含启用字段（写路径可接受的 key 集合）。
 */
export async function fieldValuesJsonSchema(projectId: string, includeArchived = false) {
  const fields = await listCustomFields(projectId, includeArchived);
  const enabled = fields.filter((f) => !f.isArchived);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of enabled) {
    properties[f.key] = fieldJsonSchema(f);
    if (f.isRequired) required.push(f.key);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Issue.fieldValues",
    description:
      "Issue 自定义字段值。写入时只接受本 schema 的 key；类型/枚举/必填由服务端动态校验（422 拒绝）。null 表示清空，必填字段不允许清空。",
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
    // 展示元信息（非标准 JSON Schema 关键字，供 UI/Agent 读名称与选项标签）
    "x-fields": fields.map((f) => ({
      key: f.key,
      name: f.name,
      type: f.type,
      isRequired: f.isRequired,
      isArchived: f.isArchived,
      options: f.options ?? null,
      settings: f.settings ?? null,
    })),
  };
}

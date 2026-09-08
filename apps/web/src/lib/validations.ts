import { z } from "zod";
import { parse } from "@/lib/api";
import type { IssueFilters } from "@/lib/dto";
import { API_SCOPES } from "@/lib/scopes";

// 状态分组（三档结局分类，与 prisma StateGroup 枚举同步）
const STATE_GROUPS = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;

export const slugSchema = z
  .string()
  .min(1, "errors.slugMin")
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "errors.slugFormat");

// Tiptap 文档（{ type: "doc", content: [...] }）。passthrough 只为兼容编辑器的
// 节点字段，但必须设界：文档是全链唯一的无上限输入面，不限体量会一路传进
// docToText 递归（深度/节点数无界 → 500 而非 422）
export const TIPTAP_DOC_MAX_BYTES = 64 * 1024;
// 字节界挡不住深度：64KB 足以编码数千层嵌套，docToText 的裸递归会先炸调用栈。
// 越界一律 422（校验层拦住，不给 500）
export const TIPTAP_DOC_MAX_DEPTH = 200;
export const tiptapDocSchema = z
  .object({ type: z.literal("doc") })
  .passthrough()
  .superRefine((v, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(v)).length > TIPTAP_DOC_MAX_BYTES)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "errors.tiptapTooLarge", params: { max: TIPTAP_DOC_MAX_BYTES / 1024 } });
    // 迭代式测深度（自检不能也用裸递归，否则同样会炸栈）；
    // 数组/对象各计一层，doc 的 content 每包一层节点进一层 content 即 ×2
    let depth = 0;
    let level: unknown[] = [v];
    while (level.length) {
      const next: unknown[] = [];
      for (const node of level) {
        if (node && typeof node === "object") next.push(...Object.values(node));
      }
      if (!next.length) break;
      depth += 1;
      if (depth > TIPTAP_DOC_MAX_DEPTH) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "errors.tiptapTooDeep", params: { max: TIPTAP_DOC_MAX_DEPTH } });
        break;
      }
      level = next;
    }
  });

export const createCommentSchema = z.object({
  body: tiptapDocSchema,
});

// ── auth ──
// required_error/invalid_type_error：空 body / 类型错体不能漏成 zod 默认 "Required"
// ——那条路走不到字段规则消息，出口就见裸英文了
export const devLoginSchema = z.object({
  email: z
    .string({
      required_error: "errors.emailRequired",
      invalid_type_error: "errors.emailInvalid",
    })
    .email("errors.emailInvalid"),
});

export const loginSchema = z.object({
  email: z
    .string({
      required_error: "errors.emailRequired",
      invalid_type_error: "errors.emailInvalid",
    })
    .email("errors.emailInvalid"),
  password: z
    .string({
      required_error: "errors.passwordRequired",
      invalid_type_error: "errors.passwordRequired",
    })
    .min(1, "errors.passwordRequired"),
});

// 邮箱归一化口径（登录键不再硬编码后定案）：写入侧 trim + 小写——
// DB 唯一索引区分大小写而登录是 insensitive 匹配，不归一化会留下
// Admin@x.com / admin@x.com 双行共存、登录却命中歧义的口子
export const emailSchema = z.string().trim().toLowerCase().email("errors.emailInvalid");

// bcrypt 只取前 72 字节，超出即静默截断——上限必须按字节计，字符计数防不住多字节字符
export const passwordSchema = z
  .string()
  .min(8, "errors.passwordMin")
  .refine((v) => new TextEncoder().encode(v).length <= 72, "errors.passwordTooLong");

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({
      required_error: "errors.currentPasswordRequired",
      invalid_type_error: "errors.currentPasswordRequired",
    })
    .min(1, "errors.currentPasswordRequired"),
  newPassword: passwordSchema,
});

// ── 管理台 ──
export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(1, "errors.nameRequired").max(64),
  email: emailSchema,
  initialPassword: passwordSchema,
  isAdmin: z.boolean().optional(),
  memberships: z
    .array(
      z.object({
        wsSlug: z.string(),
        role: z.enum(["OWNER", "MEMBER", "GUEST"]),
      }),
    )
    .optional()
    // 同一工作区重复出现：直插会撞 @@id 复合主键炸成 500，
    // 预检成 422（与 email 撞名的错误形态一致）
    .superRefine((arr, ctx) => {
      if (!arr) return;
      const seen = new Set<string>();
      arr.forEach((m, i) => {
        if (seen.has(m.wsSlug))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "wsSlug"],
            message: "errors.membershipDuplicate",
            params: { wsSlug: m.wsSlug },
          });
        seen.add(m.wsSlug);
      });
    }),
});

// 邮箱三态（2026-10-22 编辑用户）：缺省 = 不改；null = 清空（回收密码通道，
// 有密码账号服务端拒）；字符串 = 新登录键（归一化 + insensitive 查重）
export const adminUpdateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    email: emailSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    isAdmin: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "errors.noUpdateFields" });

export const adminResetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const adminSetRoleSchema = z.object({
  wsSlug: z.string(),
  role: z.enum(["OWNER", "MEMBER", "GUEST"]).nullable(), // null = 移除成员
});

// ── api token ──
export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1, "errors.tokenNameRequired").max(64),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "errors.scopeMin"),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(), // 缺省 = 永不过期
});

export const renameApiTokenSchema = z.object({
  name: z.string().trim().min(1, "errors.tokenNameRequired").max(64),
});

// ── 项目成员（私有项目）──
export const upsertProjectMemberSchema = z.object({
  userId: z.string(),
  role: z.enum(["ADMIN", "MEMBER", "GUEST"]),
});

// ── project ──
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "errors.projectNameRequired").max(64),
  slug: slugSchema.optional(),
  isPrivate: z.boolean().optional(),
});

// U2.2：超级管理员的工作区治理
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "errors.wsNameRequired").max(64),
  slug: slugSchema,
});

export const renameWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "errors.wsNameRequired").max(64),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    isArchived: z.boolean().optional(),
    isPrivate: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "errors.noUpdateFields",
  });

// ── state ──
export const createStateSchema = z.object({
  name: z.string().trim().min(1, "errors.stateNameRequired").max(32),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "errors.colorFormat")
    .optional(),
  group: z.enum(STATE_GROUPS).optional(),
});

export const updateStateSchema = z
  .object({
    name: z.string().trim().min(1).max(32).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "errors.colorFormat")
      .optional(),
    sequence: z.number().int().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "errors.noUpdateFields",
  });

// ── 自定义字段定义 ──
const FIELD_TYPE_VALUES = ["TEXT", "NUMBER", "DATE", "SELECT", "USER"] as const;

const fieldOptionSchema = z.object({
  value: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  color: z.string().trim().max(16).optional(),
  archived: z.boolean().optional(),
});

// 字段级通知规则（仅非空时生效）
const fieldNotifyRuleSchema = z.object({
  values: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  notify: z.array(z.enum(["PROJECT_LEAD", "FIELD_USERS"])).min(1).max(5),
});

// 类型专属配置（与 SELECT 的 options 数组分开，避免联合类型扩散）
const fieldSettingsSchema = z.object({
  multiple: z.boolean().optional(), // SELECT/USER：多选
  notifyOn: fieldNotifyRuleSchema.optional(), // afterWrite 字段级通知规则
});

export const createCustomFieldSchema = z.object({
  // key 不可变：Agent API / 保存视图 / Activity 均以它为锚
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "errors.fieldKeyFormat"),
  name: z.string().trim().min(1).max(40),
  type: z.enum(FIELD_TYPE_VALUES),
  options: z.array(fieldOptionSchema).max(50).optional(),
  settings: fieldSettingsSchema.optional(),
  isRequired: z.boolean().optional(),
  sequence: z.number().int().optional(),
});

// key / type 不可变（改类型会令存量值失去语义）
export const updateCustomFieldSchema = createCustomFieldSchema
  .partial()
  .omit({ key: true, type: true });

// 导入 schema 以导出物为契约（exportCustomFields 的产物必须原样可导入）：
// settings 可为 null（导出侧 ?? null）、isArchived 随行（否则归档字段导入静默复活）
export const importCustomFieldsSchema = z.object({
  fields: z
    .array(
      createCustomFieldSchema.extend({
        settings: fieldSettingsSchema.nullable().optional(),
        isArchived: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100),
});

// ── issue ──
export const createIssueSchema = z.object({
  title: z.string().trim().min(1, "errors.titleRequired").max(255),
  description: tiptapDocSchema.nullable().optional(),
  descriptionText: z.string().max(20000).optional(),
  // stateId：非空字符串（空串是前端占位残留，不该被静默吞成默认状态）
  stateId: z.string().min(1, "errors.stateIdInvalid").nullable().optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  // 自定义字段值 {key: value}；类型/必填由项目字段定义动态校验（registry）
  fieldValues: z.record(z.string(), z.unknown()).optional(),
});

export const updateIssueSchema = createIssueSchema
  .partial()
  .extend({ isArchived: z.boolean().optional() });

// U3.1：批量更新（每条逐次复用 updateIssue——Activity/通知/护栏全部继承）
export const batchUpdateIssueSchema = z.object({
  numbers: z.array(z.number().int().positive().max(2_147_483_647)).min(1).max(100),
  patch: updateIssueSchema
    .pick({ stateId: true, assigneeIds: true, isArchived: true })
    .refine((v) => Object.keys(v).length > 0, { message: "errors.patchRequired" }),
});

// U3.2：保存视图（query = IssueFilters JSON 序列化）
export const createViewSchema = z.object({
  name: z.string().trim().min(1).max(48),
  query: z.string().min(2).max(1024),
});

// ── issue 列表查询参数 ──
const ISSUE_ORDER_FIELDS = ["updatedAt", "createdAt"] as const;
export type IssueOrderField = (typeof ISSUE_ORDER_FIELDS)[number];

// 页码式分页。page 1 起；pageSize 10–500，缺省 50（列表 50 / 看板 500 由前端按视图传）
const issueQuerySchema = z.object({
  stateId: z.string().optional(),
  assigneeId: z.string().optional(),
  q: z.string().max(128).optional(),
  archived: z.enum(["true", "false"]).optional(),
  // U1.4：列头排序（服务端化，进 URL）；主干仅保留时间序，分类/日期语义归自定义字段
  orderBy: z.enum(ISSUE_ORDER_FIELDS).optional(),
  orderDir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(10).max(500).optional(),
});

type IssueListQuery = {
  filters: IssueFilters;
  page: number;
  pageSize: number;
};

export function parseIssueQuery(sp: URLSearchParams): IssueListQuery {
  const raw: Record<string, string> = {};
  // cf.<key> 为自定义字段过滤（key 动态，不能进固定 schema），单独收拢
  const fieldValues: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (v === "") continue;
    if (k.startsWith("cf.")) {
      const key = k.slice(3);
      if (key) fieldValues[key] = v;
      continue;
    }
    raw[k] = v;
  }
  // 用 parse 助手而非 .parse()：422 时输出项目统一的友好文案（而非 zod 原始 dump）
  const parsed = parse(issueQuerySchema, raw);
  const { page, pageSize, ...rest } = parsed;
  return {
    filters: {
      ...rest,
      archived:
        parsed.archived === undefined ? undefined : parsed.archived === "true",
      ...(Object.keys(fieldValues).length ? { fieldValues } : {}),
    },
    page: page ?? 1,
    pageSize: pageSize ?? 50,
  };
}

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "@/lib/api";
import {
  TIPTAP_DOC_MAX_BYTES,
  adminUpdateUserSchema,
  batchUpdateIssueSchema,
  createApiTokenSchema,
  createIssueSchema,
  createProjectSchema,
  createViewSchema,
  createStateSchema,
  emailSchema,
  loginSchema,
  parseIssueQuery,
  passwordSchema,
  slugSchema,
  tiptapDocSchema,
  TIPTAP_DOC_MAX_DEPTH,
  updateIssueSchema,
  updateStateSchema,
  devLoginSchema,
  adminCreateUserSchema,
} from "@/lib/validations";

/** 422 断言助手：统一走 zod 报错路径 */
function rejects(schema: z.ZodTypeAny, input: unknown) {
  const r = schema.safeParse(input);
  return r.success === false;
}

describe("slugSchema", () => {
  it("合法 slug", () => {
    expect(slugSchema.parse("main")).toBe("main");
    expect(slugSchema.parse("a-b-c2")).toBe("a-b-c2");
  });
  it("非法形态拒绝（大写/下划线/首尾连字符/空）", () => {
    for (const s of ["Abc", "a_b", "-a", "a-", "", "a--b"]) {
      expect(rejects(slugSchema, s), `"${s}" 应被拒绝`).toBe(true);
    }
  });
  it("超长拒绝（>48）", () => {
    expect(rejects(slugSchema, "a".repeat(49))).toBe(true);
  });
});

describe("emailSchema（登录键归一化）", () => {
  it("trim + 小写归一", () => {
    expect(emailSchema.parse("  Admin@Example.COM ")).toBe("admin@example.com");
  });
  it("非法格式拒绝", () => {
    expect(rejects(emailSchema, "not-an-email")).toBe(true);
    expect(rejects(emailSchema, "")).toBe(true);
  });
});

describe("passwordSchema（bcrypt 72 字节上限按字节计）", () => {
  it("合法密码", () => {
    expect(passwordSchema.parse("12345678")).toBe("12345678");
  });
  it("短于 8 位拒绝", () => {
    expect(rejects(passwordSchema, "1234567")).toBe(true);
  });
  it("多字节字符按字节而非字符计数（24 汉字=72 字节合法，25 汉字拒绝）", () => {
    expect(passwordSchema.parse("汉".repeat(24))).toBe("汉".repeat(24));
    expect(rejects(passwordSchema, "汉".repeat(25))).toBe(true);
    expect(rejects(passwordSchema, "a".repeat(73))).toBe(true);
  });
});

describe("tiptapDocSchema（文档体量设界）", () => {
  it("最小合法文档", () => {
    expect(tiptapDocSchema.parse({ type: "doc" })).toEqual({ type: "doc" });
  });
  it("非 doc 类型拒绝", () => {
    expect(rejects(tiptapDocSchema, { type: "paragraph" })).toBe(true);
  });
  it("超过 64KB 上限拒绝（防递归 500）", () => {
    const huge = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(TIPTAP_DOC_MAX_BYTES) }] }],
    };
    expect(rejects(tiptapDocSchema, huge)).toBe(true);
  });
  it("嵌套深度超界拒绝——64KB 挡不住的深栈（docToText 裸递归会先炸）", () => {
    // content/paragraph 逐层包裹，总字节数远小于 64KB；深度计算口径 = 实现的
    // 迭代 BFS（数组/对象各计一层），这里按 wrap 数乘 2 取深
    const wrapped = (wraps: number): unknown => {
      let node: unknown = { type: "text", text: "x" };
      for (let i = 0; i < wraps; i++) node = { type: "paragraph", content: [node] };
      return { type: "doc", content: [node] };
    };
    expect(rejects(tiptapDocSchema, wrapped(TIPTAP_DOC_MAX_DEPTH))).toBe(true);
    // 错误键是深度闸专用（非笼统体积错误）
    const r = tiptapDocSchema.safeParse(wrapped(TIPTAP_DOC_MAX_DEPTH));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe("errors.tiptapTooDeep");
  });
  it("合法深度的嵌套放行（自证深闸不误伤正常文档）", () => {
    const wrapped = (wraps: number): unknown => {
      let node: unknown = { type: "text", text: "x" };
      for (let i = 0; i < wraps; i++) node = { type: "paragraph", content: [node] };
      return { type: "doc", content: [node] };
    };
    // 每包一层产生「对象层 + 数组层」两计数：10 层包裹 = 深度 20 < 200
    expect(rejects(tiptapDocSchema, wrapped(10))).toBe(false);
  });
});

describe("登录/直登 schema", () => {
  it("loginSchema 正常解析", () => {
    expect(loginSchema.parse({ email: "a@b.co", password: "x" })).toEqual({ email: "a@b.co", password: "x" });
  });
  it("缺密码拒绝（错误键走 passwordRequired 而非裸 Required）", () => {
    const r = loginSchema.safeParse({ email: "a@b.co" });
    expect(r.success).toBe(false);
    // 键位锚定：required_error 映射若退化为 zod 默认 "Required"，下一条断言红
    expect(!r.success && r.error.issues[0]?.message).toBe("errors.passwordRequired");
  });
  it("devLoginSchema 缺 email 拒绝", () => {
    expect(rejects(devLoginSchema, {})).toBe(true);
  });
});

describe("adminUpdateUserSchema（邮箱三态）", () => {
  it("缺省 = 不改：信息缺失（noUpdateFields）拒绝", () => {
    expect(rejects(adminUpdateUserSchema, {})).toBe(true);
  });
  it("null = 清空 email；字符串 = 改键", () => {
    expect(adminUpdateUserSchema.parse({ email: null })).toEqual({ email: null });
    expect(adminUpdateUserSchema.parse({ email: " A@B.CO " })).toEqual({ email: "a@b.co" });
  });
  it("isActive/isAdmin 可单独改", () => {
    expect(adminUpdateUserSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(adminUpdateUserSchema.parse({ isAdmin: true })).toEqual({ isAdmin: true });
  });
});

describe("adminCreateUser memberships 预检", () => {
  it("同一 wsSlug 重复出现 422（直插会撞复合主键炸 500，预检成 422）", () => {
    const r = adminCreateUserSchema.safeParse({
      name: "N",
      email: "dup@test.invalid",
      initialPassword: "Abcdef12",
      memberships: [
        { wsSlug: "main", role: "MEMBER" },
        { wsSlug: "main", role: "GUEST" },
      ],
    });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0]?.message).toBe("errors.membershipDuplicate");
    // 不重复的合法携带不受扰
    expect(
      adminCreateUserSchema.parse({
        name: "N",
        email: "dup2@test.invalid",
        initialPassword: "Abcdef12",
        memberships: [
          { wsSlug: "main", role: "MEMBER" },
          { wsSlug: "aux", role: "GUEST" },
        ],
      }).memberships,
    ).toHaveLength(2);
  });
});

describe("api token schemas", () => {
  it("scopes 至少一个且必须白名单内", () => {
    expect(createApiTokenSchema.parse({ name: "t", scopes: ["issues:read"] })).toEqual({
      name: "t",
      scopes: ["issues:read"],
    });
    expect(rejects(createApiTokenSchema, { name: "t", scopes: [] })).toBe(true);
    expect(rejects(createApiTokenSchema, { name: "t", scopes: ["issues:admin"] })).toBe(true);
  });
  it("有效期范围 1–365 天或缺省/显式 null（永不过期）", () => {
    expect(rejects(createApiTokenSchema, { name: "t", scopes: ["*"], expiresInDays: 0 })).toBe(true);
    expect(rejects(createApiTokenSchema, { name: "t", scopes: ["*"], expiresInDays: 366 })).toBe(true);
    expect(
      createApiTokenSchema.parse({ name: "t", scopes: ["*"], expiresInDays: null }).expiresInDays,
    ).toBeNull();
  });
  it("名称必填去空格", () => {
    expect(rejects(createApiTokenSchema, { name: " ", scopes: ["*"] })).toBe(true);
  });
});

describe("project / state schemas", () => {
  it("createProject 共有可选 slug/私有标记", () => {
    expect(createProjectSchema.parse({ name: "P", slug: "my-slug" })).toEqual({
      name: "P",
      slug: "my-slug",
    }); // 可选 slug 的携带路径：从 schema 整行删除此断言红
    expect((createProjectSchema.parse({ name: "P" }) as { slug?: string }).slug).toBeUndefined();
    expect(createProjectSchema.parse({ name: "P", isPrivate: true })?.isPrivate).toBe(true);
    expect(rejects(createProjectSchema, { name: " " })).toBe(true);
  });
  it("createState 颜色必须是 #RRGGBB", () => {
    expect(createStateSchema.parse({ name: "进行中", color: "#aABBcc" })).toEqual({
      name: "进行中",
      color: "#aABBcc",
    });
    expect(rejects(createStateSchema, { name: "x", color: "#abc" })).toBe(true);
    expect(rejects(createStateSchema, { name: "x", color: "red" })).toBe(true);
  });
  it("updateState 空 patch 拒绝", () => {
    expect(rejects(updateStateSchema, {})).toBe(true);
    expect(updateStateSchema.parse({ sequence: 3 }).sequence).toBe(3);
  });
});

describe("issue schemas", () => {
  it("createIssue：标题必填、stateId 空串拒绝（前端占位不静默吞）", () => {
    expect(rejects(createIssueSchema, { title: "" })).toBe(true);
    expect(createIssueSchema.parse({ title: "T", stateId: null }).stateId).toBeNull();
    expect(rejects(createIssueSchema, { title: "T", stateId: "" })).toBe(true);
  });
  it("updateIssue 为部分更新形态（全部可缺省）", () => {
    expect(updateIssueSchema.parse({})).toEqual({});
    expect(updateIssueSchema.parse({ isArchived: true }).isArchived).toBe(true);
  });
  it("batch patch 必须至少含一个可改字段", () => {
    expect(rejects(batchUpdateIssueSchema, { numbers: [1], patch: {} })).toBe(true);
    expect(rejects(batchUpdateIssueSchema, { numbers: [], patch: { stateId: "x" } })).toBe(true);
    expect(batchUpdateIssueSchema.parse({ numbers: [1, 2], patch: { isArchived: true } }).numbers).toEqual([1, 2]);
  });
  it("createView：query 序列化串限长（下限 2 与上限 1024 都锚定）", () => {
    expect(createViewSchema.parse({ name: "V", query: "{}" })).toEqual({ name: "V", query: "{}" });
    expect(rejects(createViewSchema, { name: "V", query: "x" })).toBe(true); // min(2)
    expect(rejects(createViewSchema, { name: "", query: "{}" })).toBe(true);
    expect(rejects(createViewSchema, { name: "V", query: "a".repeat(1025) })).toBe(true); // max(1024)
    expect(createViewSchema.parse({ name: "V", query: "a".repeat(1024) }).query).toHaveLength(1024);
  });
});

describe("parseIssueQuery", () => {
  it("缺省分页 page=1 / pageSize=50", () => {
    const r = parseIssueQuery(new URLSearchParams(""));
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(50);
    expect(r.filters.archived).toBeUndefined();
  });

  it("cf.<key> 收拢进 filters.fieldValues，固定参数互不污染", () => {
    const r = parseIssueQuery(
      new URLSearchParams("stateId=s1&cf.severity=s2&cf.customer=ACME&page=2&pageSize=20"),
    );
    expect(r.filters.fieldValues).toEqual({ severity: "s2", customer: "ACME" });
    expect(r.filters.stateId).toBe("s1");
    expect(r.page).toBe(2);
    expect(r.pageSize).toBe(20);
  });

  it("空串参数一律跳过（含 cf.* 值与键）", () => {
    const r = parseIssueQuery(
      new URLSearchParams("stateId=&q=&cf.=x&cf.k&cf.k2=&page=3"),
    );
    expect(r.filters.stateId).toBeUndefined();
    expect(r.filters.q).toBeUndefined();
    expect(r.filters.fieldValues).toBeUndefined();
    expect(r.page).toBe(3);
  });

  it("archived 三态：缺省 undefined / true / false", () => {
    expect(parseIssueQuery(new URLSearchParams("")).filters.archived).toBeUndefined();
    expect(parseIssueQuery(new URLSearchParams("archived=true")).filters.archived).toBe(true);
    expect(parseIssueQuery(new URLSearchParams("archived=false")).filters.archived).toBe(false);
  });

  it("排序参数透传", () => {
    const r = parseIssueQuery(new URLSearchParams("orderBy=createdAt&orderDir=asc"));
    expect(r.filters.orderBy).toBe("createdAt");
    expect(r.filters.orderDir).toBe("asc");
  });

  it("越界分页抛 ValidationError（422）", () => {
    try {
      parseIssueQuery(new URLSearchParams("pageSize=9"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).status).toBe(422);
    }
  });
});

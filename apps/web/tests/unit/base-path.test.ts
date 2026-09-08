import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BASE_PATH 在模块加载时定值，用例间 vi.resetModules + 动态 import 重放取值链。
// 客户端 bundle 实际读 NEXT_PUBLIC_BASE_PATH（next.config 的 env 注入，与 basePath 同值）
// ——服务端读 BASE_PATH——归一化两边共用同一实现。

const DEFAULT = "/solo-issue";

function setEnv(nextPublic?: string, base?: string) {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.BASE_PATH;
  if (nextPublic !== undefined) process.env.NEXT_PUBLIC_BASE_PATH = nextPublic;
  if (base !== undefined) process.env.BASE_PATH = base;
}

async function loadBasePath() {
  const mod = await import("@/lib/base-path");
  return mod.BASE_PATH;
}

describe("base-path", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setEnv();
  });

  it("两变量皆缺省回退默认子路径", async () => {
    setEnv();
    expect(await loadBasePath()).toBe(DEFAULT);
  });

  it("空串视同未配置，回退默认子路径", async () => {
    setEnv(undefined, "");
    expect(await loadBasePath()).toBe(DEFAULT);
  });

  it("单个斜杠同样归一为根路径部署", async () => {
    setEnv(undefined, "/");
    expect(await loadBasePath()).toBe("");
  });

  it("无前导斜杠自动补，尾部斜杠去除，多前导斜杠折叠", async () => {
    setEnv(undefined, "custom");
    expect(await loadBasePath()).toBe("/custom");
    vi.resetModules();
    setEnv(undefined, "/custom/");
    expect(await loadBasePath()).toBe("/custom");
    vi.resetModules();
    setEnv(undefined, "//issues");
    expect(await loadBasePath()).toBe("/issues");
  });

  it("NEXT_PUBLIC_BASE_PATH 重放客户端闭环：/ 由客户端归一为根路径部署", async () => {
    setEnv("/", undefined); // next.config 以 BASE_PATH || "/" 注入客户端——重放 normalize 后应为根
    expect(await loadBasePath()).toBe("");
  });

  it("NEXT_PUBLIC_BASE_PATH 优先于 BASE_PATH（客户端内联值与构建产物同源）", async () => {
    setEnv("/from-next-public", "/from-base");
    expect(await loadBasePath()).toBe("/from-next-public");
  });

  it("withBase 为根相对路径追加部署前缀", async () => {
    setEnv();
    const { BASE_PATH, withBase } = await import("@/lib/base-path");
    expect(BASE_PATH).toBe(DEFAULT);
    expect(withBase("/api/health")).toBe(`${BASE_PATH}/api/health`);
    expect(withBase("/w/main")).toBe(`${BASE_PATH}/w/main`);
  });

  it("根路径部署（BASE_PATH=/）时 withBase 原样透传", async () => {
    setEnv(undefined, "/");
    const { withBase } = await import("@/lib/base-path");
    expect(withBase("/api/health")).toBe("/api/health");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// env() 惰性校验 + 进程内 memo，用例间 vi.resetModules + 动态 import 重放取值链。
// MAX_UPLOAD_MB 的空串归一针对 docker compose 的 `${VAR:-}` 缺省形态：
// 值存在但为空串（非 undefined），.default 不生效，直接 coerce 会得 0 触发 positive 门禁
// （线上形态：issue 列表路由模组加载期 500）。

function resetEnvVars(max?: string) {
  delete process.env.MAX_UPLOAD_MB;
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  if (max !== undefined) process.env.MAX_UPLOAD_MB = max;
}

async function loadEnv() {
  const mod = await import("@/lib/env");
  return mod.env();
}

describe("env()", () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnvVars();
  });

  afterEach(() => {
    delete process.env.MAX_UPLOAD_MB;
  });

  it("未设置时回退默认 10", async () => {
    resetEnvVars(undefined);
    expect((await loadEnv()).MAX_UPLOAD_MB).toBe(10);
  });

  it("compose 空串注入归一为缺省，不被 coerce 成 0", async () => {
    resetEnvVars("");
    expect((await loadEnv()).MAX_UPLOAD_MB).toBe(10);
  });

  it("数字串正常通过", async () => {
    resetEnvVars("50");
    expect((await loadEnv()).MAX_UPLOAD_MB).toBe(50);
  });

  it("非正数进入校验即炸，不静默兜底", async () => {
    resetEnvVars("0");
    await expect(loadEnv()).rejects.toThrow();
  });
});

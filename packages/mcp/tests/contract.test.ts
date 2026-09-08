import { describe, expect, it } from "vitest";
import { ApiHttpError } from "../src/errors";
import { MetaInfo, SelfCheckError, SUPPORTED_CONTRACTS, X_CLIENT, runSelfCheck } from "../src/contract";

const meta = (apiContractVersion = 1): MetaInfo => ({
  version: "0.0.1",
  apiContractVersion,
  minMcpVersion: "0.0.1",
});

describe("runSelfCheck（启动软闸分诊）", () => {
  it("契约在支持范围内放行", async () => {
    await expect(runSelfCheck(async () => meta())).resolves.toEqual(meta());
  });

  it("401 → 重新签发指引", async () => {
    await expect(
      runSelfCheck(async () => {
        throw new ApiHttpError(401, "token invalid");
      }),
    ).rejects.toThrow(/重新签发/);
  });

  it("426 → 升级指引", async () => {
    await expect(
      runSelfCheck(async () => {
        throw new ApiHttpError(426, "upgrade to 0.0.1");
      }),
    ).rejects.toThrow(/npx -y solo-issue-mcp@latest/);
  });

  it("其他 HTTP 错误 → 状态码 + 服务端消息", async () => {
    await expect(
      runSelfCheck(async () => {
        throw new ApiHttpError(503, "maintenance");
      }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("网络异常 → URL 检查指引", async () => {
    await expect(
      runSelfCheck(async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toThrow(/SOLO_ISSUE_URL/);
  });

  it("契约版本越界 → 升级指引且报出两侧范围", async () => {
    await expect(runSelfCheck(async () => meta(2))).rejects.toThrow(
      new RegExp(`v2.*${SUPPORTED_CONTRACTS.join("/")}.*solo-issue-mcp@latest`),
    );
  });
});

describe("版本协商常量", () => {
  it("X-Client 形态为 solo-issue-mcp/<包版本>（与服务端版本闸约定一致）", () => {
    expect(X_CLIENT).toMatch(/^solo-issue-mcp\/\d+\.\d+\.\d+$/);
  });
});

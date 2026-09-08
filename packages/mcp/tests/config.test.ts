import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("缺 URL / 缺 TOKEN 分别给出可操作指引", () => {
    expect(() => loadConfig({})).toThrow(/SOLO_ISSUE_URL/);
    expect(() => loadConfig({ SOLO_ISSUE_TOKEN: "itr_x" })).toThrow(/SOLO_ISSUE_URL/);
    expect(() => loadConfig({ SOLO_ISSUE_URL: "http://x/solo-issue" })).toThrow(/SOLO_ISSUE_TOKEN/);
  });

  it("非法 URL / 非 http(s) 协议拒绝（本地校验，无 HTTP 语义）", () => {
    expect(() => loadConfig({ SOLO_ISSUE_URL: "not-a-url", SOLO_ISSUE_TOKEN: "itr_x" })).toThrow(
      ConfigError,
    );
    expect(() =>
      loadConfig({ SOLO_ISSUE_URL: "ftp://x/solo-issue", SOLO_ISSUE_TOKEN: "itr_x" }),
    ).toThrow(ConfigError);
  });

  it("尾斜杠归一，token 去首尾空白后透传", () => {
    const cfg = loadConfig({
      SOLO_ISSUE_URL: "http://localhost:8081/solo-issue/",
      SOLO_ISSUE_TOKEN: " itr_x ",
    });
    expect(cfg).toEqual({ baseUrl: "http://localhost:8081/solo-issue", token: "itr_x" });
  });
});

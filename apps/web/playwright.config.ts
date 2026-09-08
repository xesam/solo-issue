import { defineConfig } from "@playwright/test";

import "dotenv/config"; // BASE_PATH 与被测服务同源（.env 可自定义部署前缀）
import { BASE_PATH } from "./src/lib/base-path";

// E2E 分层约定见 docs/10-testing.md：
// - 只覆盖跨页面关键旅程（登录/创建/流转/评论@/通知/搜索），单元与 service 集成由 vitest 承担
// - 服务复用：本地跑复用 E2E_ROOT（默认 8081）上已起的服务（dev 或 pnpm start）；
//   `pnpm verify` 由 verify-all.sh 先行起服（独立端口 + E2E_ROOT 指向），本配置探测健康检查后就绪

const ROOT = process.env.E2E_ROOT ?? "http://localhost:8081";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false, // 单服务单库：旅程串行，避免通知/时间线互相穿场
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: ROOT, // 注意：页面路径必须经 e2e/utils.ts 的 appUrl() 拼上 BASE_PATH ——
    // goto("/signin") 这类绝对路径会按 URL 语义洗掉子路径，落成 404
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "zh-CN",
  },
  expect: {
    timeout: 10_000,
  },
  webServer: {
    command: "pnpm start",
    url: `${ROOT}${BASE_PATH}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

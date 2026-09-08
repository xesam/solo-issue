import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 测试体系约定见 docs/10-testing.md：
// - unit        纯逻辑层，无 DB / 网络依赖，任何环境必须可跑
// - integration DB 直连（DATABASE_URL），自建 fixture 自清理，须先 seed 之外不依赖任何既有数据
// 两个 project 拆开跑：本地快速回路 `pnpm test:unit`；全量门禁 `pnpm test`（pnpm verify 管道用）

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": resolve("./src") },
  },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/integration/setup.ts"],
          // DB 是共享资源：文件串行，避免 fixture 清理与限流窗口互相干扰
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      // 覆盖率只度量测试层所能触达的服务端/纯逻辑面；四类面板见 docs/10-testing.md §5：
      // - 客户端 hooks 层（E2E/smoke 背书）
      // - IM 渠道适配（外部 HTTP 契约，联调冒烟背书，见 docs/09）
      // - 任务队列启动器（pg-boss 进程编排，部署冒烟背书，入队面在接入它的测试里全量 mock）
      // - 本文件与测试自身
      include: ["src/lib/**", "src/server/**"],
      exclude: [
        "src/lib/client/**",
        "src/server/im/**",
        "src/server/queue.ts",
        "src/worker/**",
        "tests/**",
        "**/.DS_Store",
        "**/*.d.ts",
      ],
      reporter: ["text", "html", "json-summary"],
      // 门槛 = 当前实测值减 3-5 个点的回归防线：只许上抬不许下调
      //（调整流程见 docs/10-testing.md §6）
      thresholds: {
        "src/lib/**": { lines: 95, functions: 90, branches: 85, statements: 95 },
        "src/server/auth/**": { lines: 88, functions: 85, branches: 80, statements: 88 },
        "src/server/custom-fields/**": { lines: 88, functions: 85, branches: 80, statements: 88 },
        "src/lib/api.ts": { lines: 95, functions: 90, branches: 90, statements: 95 },
        "src/server/rate-limit.ts": { lines: 88, functions: 85, branches: 75, statements: 88 },
        // 全局兜底：核心服务层当前整体水位 80+，含 auth-im/im-send（IM 渠道，
        // 0% 属实—外部 HTTP 契约由联调冒烟背书，见 §4 面板说明）
        lines: 75,
        functions: 70,
        branches: 65,
        statements: 75,
      },
    },
  },
});

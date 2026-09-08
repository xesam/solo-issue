import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  // bin 产物名用 .js：npm 对 bin 指向 .mjs 会判 invalid 并从 tarball 剔除；
  // ESM 语义由 package.json 的 "type": "module" 保证，与扩展名无关
  outExtensions: () => ({ js: ".js" }),
});

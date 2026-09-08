import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import "dotenv/config"; // 构建期与运行期同源：pnpm build 不经 dotenv 预载经 next build 时读 .env
import { BASE_PATH } from "./src/lib/base-path";

const nextConfig: NextConfig = {
  // 生产镜像内以 `next start` 运行，无需 standalone 产物
  // 子路径部署：线上经网关/nginx 反代挂载在 basePath（默认 /solo-issue，可经 BASE_PATH 自定义）之下
  basePath: BASE_PATH,
  // 客户端 bundle 内联：base-path.ts 在客户端读 NEXT_PUBLIC_BASE_PATH——
  // 此处把它与 basePath 设成同值，.env 只需写 BASE_PATH 一处即可对构建与运行同时生效。
  // 根路径部署时 BASE_PATH 归一为空串：注入 "/" 而非空串（Next 会原样注入空串，
  // 客户端的 || 取值链会把它误回退成默认前缀），客户端重放 normalize("/") → "" 的同一闭环
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH || "/" },
  experimental: {},
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

// next-intl：请求配置在 src/i18n/request.ts（无路由前缀模式，locale 走 cookie/头协商）
export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);

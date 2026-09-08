// 部署 basePath 的单一事实源——next.config.ts 与客户端请求/跳转共用。
// 取值链：NEXT_PUBLIC_BASE_PATH（构建期内联进客户端 bundle——由 next.config 的 env 注入，
// 值与 basePath 同源）→ BASE_PATH（服务端/运行期）→ 默认 "/solo-issue"。
// 空串/未设置视同默认子路径；显式设 "/" 为根路径部署（无前缀）；无前导斜杠自动补；尾部斜杠去除。
// ⚠️ 构建期配置：路由挂载（next.config 的 basePath）与客户端内联都在 next build 时定死——
// 改值须重新构建，且构建与运行期保持同一取值（Docker 由 compose 同时注入 build args 与运行 env；
// 裸机经 next.config 的 dotenv 预载，构建与运行读同一份 .env）。
// 注意：Next.js 的 basePath 只作用于服务端路由挂载（API 实际在 <BASE_PATH>/api/*），
// 客户端的 fetch / window.location / <img src> / <a href> 不会自动加前缀，必须显式 withBase()

const DEFAULT_BASE_PATH = "/solo-issue";

function normalize(raw: string): string {
  const p = raw.trim();
  if (!p) return "";
  // 折叠多前导斜杠：防 withBase 产出以 // 开头的 protocol-relative URL（会被浏览器当域名解析）
  return (p.startsWith("/") ? p : `/${p}`).replace(/^\/{2,}/, "/").replace(/\/+$/, "");
}

export const BASE_PATH = normalize(
  process.env.NEXT_PUBLIC_BASE_PATH || process.env.BASE_PATH || DEFAULT_BASE_PATH,
);

export function withBase(url: string): string {
  return `${BASE_PATH}${url}`;
}

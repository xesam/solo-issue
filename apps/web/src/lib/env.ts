import { z } from "zod";
import { BASE_PATH } from "./base-path";

// 环境变量统一校验（见下方「校验时机」注记）：配置错误尽早暴露。
// 企微凭证（WECOM_*）不在此列——由 server/im/wecom/config.ts 直读
// process.env（env 优先于 ProviderCredential 表、可热开关的层进逻辑在那边自洽）
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL 未设置（见 .env.example）"),
  // 对外基址：经 env() 校验的 APP_URL 仅用于 IM 推送深链（im-send.ts）。
  // 企微 OAuth 三个路由直读 process.env.APP_URL，缺省回退请求 origin——
  // 两处口径有意并行（OAuth 回调高可用优先），生产环境务必显式设置。
  // 缺省推导含部署 basePath（PORT + BASE_PATH）
  APP_URL: z
    .string()
    .url()
    .default(`http://localhost:${process.env.PORT ?? "8081"}${BASE_PATH}`),
  // 非数字值若放行会在附件大小校验中变成 NaN（恒 false，上限失效），必须启动期毙掉
  // compose 的映射 `${MAX_UPLOAD_MB:-}` 缺省时注入空串（值存在、非 undefined），若直接
  // coerce 会被转成 0 触发 positive 门禁——先归一为 undefined 让 default 兜底
  MAX_UPLOAD_MB: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().positive().max(1024).default(10),
  ),
});

type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

// 校验时机：惰性 + 进程内 memo。worker 进程启动即触发（import 链上有 env()）；
// Web 进程按路由模块懒加载，首个命中 env() 的请求才校验失败——
// /api/health、/api/meta 探活路径不经过 env()，坏配置探活发现不了
export function env(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}

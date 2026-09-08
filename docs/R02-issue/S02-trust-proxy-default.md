# S02 `TRUST_PROXY` 缺省采信转发头，IP 限流可被绕过

> 状态：待处理（不阻塞 0.0.1 内测）｜严重度：低｜记录日期：2026-10-23
> 2026-10-26 进展：`apps/web/.env.example` 已补 `TRUST_PROXY` 说明项（§5 第一项的 env.example 部分）；`docs/08-deployment.md` 表项（`:226`）与 Nginx XFF 覆盖写示例（`:195-199`）已就位。README §4.1 部分仍待办。

## 1. 现象

`clientIp`（`apps/web/src/server/rate-limit.ts:38`）在未设置 `TRUST_PROXY` 时，取 `X-Forwarded-For` 的第一段，其次取 `X-Real-IP`。客户端可以伪造这两个请求头，每次换一个值就能绕开按 IP 分桶的限流。以下两种部署都受影响：

- 应用端口直接对外，前面没有反向代理；
- 前面有反向代理，但代理把 `X-Forwarded-For` 追加写入而不是覆盖写入（例如 Nginx 常见的 `$proxy_add_x_forwarded_for`）：客户端伪造的值仍在第一段。

## 2. 受影响的入口

| 入口 | IP 桶 | 非 IP 维度兜底 |
|---|---|---|
| `/api/auth/login` | 10 次/分（`apps/web/src/app/api/auth/login/route.ts:19`） | 有：邮箱桶 10 次/分（`:23`） |
| `/api/auth/wecom/start` | 20 次/分（`.../wecom/start/route.ts:19`） | 无 |
| `/api/auth/wecom/web-start` | 20 次/分（`.../wecom/web-start/route.ts:21`） | 无 |
| `/api/auth/wecom/callback` | 30 次/分（`.../wecom/callback/route.ts:43`） | 无 |
| `/api/auth/dev-login` | 10 次/分（`.../dev-login/route.ts:21`） | 无 |

API 令牌的 120 次/分钟频控按令牌计数（`apps/web/src/server/auth/token.ts:63`），不受影响。

## 3. 实际风险

绕过 IP 限流能得到的收益有限：

- 密码登录有邮箱桶兜底，针对单个账号的暴力尝试仍被限制在 10 次/分钟；
- `wecom/start`、`web-start` 负责构建企微授权 URL 并跳转（`docs/01-architecture.md` §4.2）；
- `wecom/callback` 需要企微签发的一次性 code，绕过限流只会放大无效 code 对企微接口的调用量；
- `dev-login` 在生产模式默认关闭；开启时它本身就不校验密码，限流不是它的安全边界。

## 4. 为什么不直接把缺省改成"不采信"

设置 `TRUST_PROXY=0` 后，所有匿名请求的 IP 都归为 `unknown`，共用一个桶（`rate-limit.ts:30-37` 注释）。直连部署如果把缺省改成不采信，全站登录会共享 10 次/分钟的 IP 额度，同一分钟内超过 10 次登录请求就会互相触发 429。

根治办法是取 TCP 连接的对端地址，但 Next.js 15 的 Route Handler 不提供这个值（`NextRequest.ip` 已在 15 版移除），只能改用自定义 server，这与"轻部署"的取向冲突。

另外，接入企微的部署实际需要前置反向代理（见 [S03](S03-wecom-onboarding-prerequisites.md) §3）。在这个主场景下，缺省采信转发头是合理的。

## 5. 处理方案（推荐：保持缺省，补文档）

- `README.md` §4.1 和 `apps/web/.env.example` 补充 `TRUST_PROXY` 说明（目前两处都没有提到）；
- `docs/08-deployment.md` 环境变量表（`:85`）补充 `TRUST_PROXY=0` 的副作用：全部匿名请求共享一个 IP 桶；
- `docs/08-deployment.md` 给出反向代理的配置要求：覆盖写入 `X-Forwarded-For`，附 Nginx 示例：

```nginx
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
```

可选的代码改动：单层反向代理部署下，`clientIp` 改为取 `X-Forwarded-For` 的最后一段（由可信代理追加的那一段）。这样即使代理用了追加写入，也不会被伪造。代价是多层代理时取到的是内层代理地址，需要增加配置项说明代理层数。

## 6. 验收标准

- `README.md`、`apps/web/.env.example`、`docs/08-deployment.md` 三处说明补齐，且与 `docs/09-wecom-setup.md` 对反向代理的表述一致；
- 如采用"取最后一段"的改动：`apps/web/tests/unit/rate-limit.test.ts` 中 `clientIp` 的用例（`:46` 起）同步更新，`pnpm test:coverage` 全绿。

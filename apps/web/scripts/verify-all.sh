#!/usr/bin/env bash
# 一键全量门禁：Docker 一次性库 + 生产构建起服 + 无副作用验收 + E2E
# 用法: pnpm verify
# 前置: ① Docker 可用 ② 本地 dev server 会被先停（build 与 dev 并发写 .next 互损，README §4.2 有警告）
# 时机: 无平台 CI，触发完全人为——建议合入 main 前择机执行；日常快回路跑 typecheck + test:coverage 即可
# 收尾: 成败都会停脚本起的服务并销毁临时库；恢复日常开发: pnpm dev:restart
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

VERIFY_PORT="${VERIFY_PORT:-8091}" # 临时服务端口，避开日常 dev 的 8081；被占用会提前红
PG_PORT=55432                     # 临时库端口，避开本地常用 5432
PG_NAME="solo-issue-verify-pg"
SERVER_PID=""

step() { printf '\n━━ %s ━━\n' "$1"; }
fail() { echo "❌ $1" >&2; exit 1; }

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    # pnpm start 会再拉起 node 子进程：连子进程一起停，防 VERIFY_PORT 泄漏到下轮
    pkill -P "$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step "前置自检（docker / 端口 / 停 dev）"
docker version >/dev/null 2>&1 || fail "Docker 不可用（临时库依赖它）"
if lsof -ti :"$VERIFY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail ":$VERIFY_PORT 已被占用（可用 VERIFY_PORT 换端口）"
fi
pnpm dev:stop || true # build 需独占 .next；worker 不碰 .next，无需停

step "一次性数据库（postgres:16-alpine）"
docker rm -f "$PG_NAME" >/dev/null 2>&1 || true # 上轮异常退出可能残留容器
docker run -d --rm --name "$PG_NAME" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=solo_issue \
  -p "$PG_PORT:5432" postgres:16-alpine >/dev/null || fail "临时库启动失败"
for _ in $(seq 1 30); do
  docker exec "$PG_NAME" pg_isready -U postgres -d solo_issue >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$PG_NAME" pg_isready -U postgres -d solo_issue >/dev/null 2>&1 \
  || fail "临时库 60s 内未就绪"

# 环境接管：dotenv 不覆盖已 export 的变量——.env 的同名配置在本轮被临时值顶替，
# 脚本结束即恢复，不污染本地配置
export DATABASE_URL="postgres://postgres:postgres@localhost:$PG_PORT/solo_issue"
export PORT="$VERIFY_PORT"                         # start 服务与 verify-* 脚本的 BASE 推导共用
export APP_URL="http://localhost:$VERIFY_PORT"
export E2E_ROOT="http://localhost:$VERIFY_PORT"    # playwright webServer 探测/复用之都指向它
export ALLOW_DEV_LOGIN=true                        # verify-agent 走 dev-login 邮箱直登
export ALLOW_IM_MOCK=true                          # E2E mock 登录与 mock 通知通道
export ADMIN_EMAIL="solo-issue@github.com"         # 防本地 .env 定制渗入临时库（三处消费的 ?? 都不回退空串，须显式占位）
export ADMIN_INIT_PASSWORD=""                      # 空串在 seed 侧为 falsy——管理员不带初始密码，保持 dev-login 直登形态
export DEMO_PROJECT="demo"                         # verify-agent 与 verify-seed 的载体项目口径锁定，防 .env 改 slug 撞空

# basePath 解析与 src/lib/base-path.ts 同语义（shell env / .env / 默认；BP 为空 = 根路径部署）
source "$ROOT_DIR/scripts/lib/base-path.sh"
solo_base_path "$ROOT_DIR"
HEALTH_URL="http://localhost:$VERIFY_PORT${APP_BASE_PATH}/api/health"

step "迁移 → 种子 → 验收数据"
pnpm db:deploy
pnpm db:seed
pnpm verify:seed

step "typecheck + 单测/集成（含覆盖率门槛）"
pnpm typecheck
pnpm test:coverage

step "生产构建"
pnpm build

step "起服（生产形态，:${VERIFY_PORT}）"
: > .verify-server.log
nohup pnpm start > .verify-server.log 2>&1 &
SERVER_PID=$!
ok=""
for _ in $(seq 1 60); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || { tail -50 .verify-server.log >&2; fail "服务 60s 内未通过健康检查"; }
echo "✅ 健康检查通过 ($HEALTH_URL)"

step "验收脚本（只跑无副作用的三个；verify-account / verify-workbench 有副作用，按需另跑）"
pnpm tsx scripts/verify-custom-fields.ts
pnpm tsx scripts/verify-agent.ts
pnpm tsx scripts/verify-mcp.ts

step "E2E（chromium 幂等安装 + Playwright 复用上面起的服务）"
pnpm exec playwright install chromium
pnpm test:e2e

step "全部通过 ✅"
echo "临时库与脚本所起服务均已清理；恢复日常开发: pnpm dev:restart"

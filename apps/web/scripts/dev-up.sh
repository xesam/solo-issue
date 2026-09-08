#!/usr/bin/env bash
# 一键冷启动本地环境：确保 Postgres 可用 → 建表（db:deploy）→ 种子（db:seed）→ 后台起 dev + worker
# 用法: pnpm dev:up
# 数据库策略: DATABASE_URL（shell 环境变量优先，缺则回落 .env——与 dotenv / dev-stop.sh 同语义）可连 → 直接用；
#             连不上且 Docker 可用 → 起仓库根 compose 的 postgres 服务并等就绪；两者都不行 → 红并给指引
#             （compose 插值源 = 仓库根 .env，POSTGRES_TAG 本地覆盖即写在那里，见 docker-compose.yml 注释）
# 迁移动词: db:deploy（非交互幂等，pnpm verify 同款）；开发期改 schema 生成新迁移用 pnpm db:migrate
# 进程托管: 末段复用 dev-restart.sh all——停旧 → 后台起新，日志 .dev-server.log / .worker.log（已 gitignore）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # 应用根 = apps/web
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"    # 仓库根 = docker-compose.yml 所在
cd "$ROOT"

step() { printf '\n━━ %s ━━\n' "$1"; }
fail() { echo "❌ $1" >&2; exit 1; }

# ── 1. 解析连接目标 ────────────────────────────────────────────────
# 与 dotenv / dev-stop.sh 的端口解析同语义：shell 环境变量优先，缺则回落 .env
if [ -n "${DATABASE_URL:-}" ]; then
  DB_URL="$DATABASE_URL"
else
  DB_URL="$(sed -nE 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ROOT/.env" 2>/dev/null | head -1 || true)"
  DB_URL="${DB_URL%%$'\n'}"
  DB_URL="${DB_URL%\"}"; DB_URL="${DB_URL#\"}" # 剥成对双引号（.env 常见写法）
  DB_URL="${DB_URL%%$'\r'}"
fi
if [ -z "$DB_URL" ]; then
  if [ ! -f "$ROOT/.env" ]; then
    fail "缺少 apps/web/.env（先执行: cp apps/web/.env.example apps/web/.env）"
  fi
  fail "DATABASE_URL 未配置（apps/web/.env 或环境变量）"
fi

# host:port 提取：剥到最后的 @（密码可含 @），再剥 /path 与 ?query；缺端口取 5432
REST="${DB_URL#*//}"
HOSTPORT="${REST##*@}"
HOSTPORT="${HOSTPORT%%/*}"
HOSTPORT="${HOSTPORT%%\?*}"
DB_HOST="${HOSTPORT%%:*}"
DB_PORT="${HOSTPORT##*:}"
if [ "$DB_PORT" = "$HOSTPORT" ]; then DB_PORT=5432; fi
[ -n "$DB_HOST" ] || fail "DATABASE_URL 解析失败: $DB_URL"

# TCP 探测（2s 硬超时）——node 是本仓库必备运行时，比 nc/pg_isready 可移植
db_probe() {
  node -e '
    const net = require("net");
    const s = net.connect({ host: process.argv[1], port: Number(process.argv[2]) }, () => { s.destroy(); process.exit(0); });
    s.on("error", () => process.exit(1));
    setTimeout(() => { s.destroy(); process.exit(1); }, 2000);
  ' "$DB_HOST" "$DB_PORT"
}

# ── 2. 确保数据库可用 ──────────────────────────────────────────────
step "数据库（${DB_HOST}:${DB_PORT}）"
if db_probe; then
  echo "✅ 数据库可连接"
else
  echo "ℹ️  连不上，尝试经 Docker 启动 compose postgres 服务…"
  docker compose version >/dev/null 2>&1 \
    || fail "数据库连不上且 Docker 不可用——请自行启动 Postgres 后重跑 pnpm dev:up"
  (cd "$REPO_ROOT" && docker compose up -d postgres) || fail "docker compose up postgres 失败（见上方输出）"
  ok=""
  for _ in $(seq 1 30); do
    db_probe && { ok=1; break; }
    sleep 2
  done
  [ -n "$ok" ] || fail "数据库等待超时（排查: docker compose logs postgres）"
  echo "✅ 数据库已就绪"
fi

# ── 3. Prisma Client + 迁移 + 种子 ─────────────────────────────────
step "Prisma Client 生成 → 迁移 → 种子"
pnpm db:generate
pnpm db:deploy \
  || fail "迁移失败：本地实验库可 pnpm db:reset 清库重来；生产库排障见 docs/DEPLOY.md §7.4"
pnpm db:seed

# ── 4. 后台起进程 ─────────────────────────────────────────────────
step "后台启动 dev + worker"
bash "$ROOT/scripts/dev-restart.sh" all
echo
echo "✅ dev:up 完成——访问地址见上一行输出；日志: .dev-server.log / .worker.log；停止: pnpm dev:stop"

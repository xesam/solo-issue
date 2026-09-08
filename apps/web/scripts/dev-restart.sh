#!/usr/bin/env bash
# 快速重启本地长驻进程：dev 服务器 / 异步 worker
# 用法:
#   pnpm dev:restart            # 重启 dev 服务器（默认）
#   pnpm dev:restart dev        # 同上
#   pnpm dev:restart worker     # 重启 worker
#   pnpm dev:restart all        # 两个都重启
# 停止逻辑来自 dev-stop.sh——单独停止用 pnpm dev:stop [dev|worker|all]
# 日志: 应用根 apps/web/ 下 .dev-server.log / .worker.log（已 gitignore）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/dev-stop.sh" # 提供 stop_dev / stop_worker / free_port / DEV_PORT

TARGET="${1:-dev}"
DEV_LOG="$ROOT/.dev-server.log"
WORKER_LOG="$ROOT/.worker.log"
WAIT_TIMEOUT=30

start_bg() { # <logfile> <command...> —— nohup 后台启动，日志落盘并脱离终端
  local log="$1"; shift
  nohup "$@" >"$log" 2>&1 &
  disown
}

wait_http() { # <url> <label> —— 轮询直到可访问
  local url="$1" label="$2" waited=0 code
  printf "⏳ 等待 %s 就绪" "$label"
  while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$url" 2>/dev/null || true)
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      echo " (HTTP $code)"
      return 0
    fi
    printf "."
    sleep 1
    waited=$((waited + 1))
  done
  echo
  echo "❌ $label ${WAIT_TIMEOUT}s 内未就绪，查看日志: tail -50 $DEV_LOG"
  return 1
}

restart_dev() {
  stop_dev
  : > "$DEV_LOG" # 清空旧日志
  start_bg "$DEV_LOG" pnpm dev
  wait_http "http://localhost:${DEV_PORT}" "dev 服务器"
  # basePath 解析与 src/lib/base-path.ts 同语义（shell env / .env / 默认，可自定义部署前缀）
  source "$ROOT/scripts/lib/base-path.sh"
  solo_base_path "$ROOT"
  echo "✅ dev 服务器 → http://localhost:${DEV_PORT}${APP_BASE_PATH}（日志: .dev-server.log）"
}

restart_worker() {
  stop_worker
  : > "$WORKER_LOG"
  start_bg "$WORKER_LOG" pnpm worker
  sleep 2
  if pgrep -f "$ROOT.*src/worker" >/dev/null; then
    echo "✅ worker 已启动（日志: .worker.log）"
  else
    echo "❌ worker 启动失败，查看日志: tail -50 $WORKER_LOG"
    return 1
  fi
}

case "$TARGET" in
  dev) restart_dev ;;
  worker) restart_worker ;;
  all) restart_dev; restart_worker ;;
  *) echo "用法: $0 [dev|worker|all]"; exit 1 ;;
esac

#!/usr/bin/env bash
# 单独停止本地长驻进程：dev 服务器 / 异步 worker（只停不启）
# 用法:
#   pnpm dev:stop            # 停止 dev 服务器（默认）
#   pnpm dev:stop dev        # 同上
#   pnpm dev:stop worker     # 停止 worker
#   pnpm dev:stop all        # 两个都停止
# 说明:
#   - dev-restart.sh 会 source 本文件复用停止逻辑（参数 dev|worker|all 与其一致）
#   - 进程按「应用根路径 + 命令片段」匹配，不会误杀其他项目的同名进程
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 端口解析优先级: shell 环境变量 PORT > .env 的 PORT > 默认 8081
# （package.json 的 dev/start 经 dotenv 预载 .env，与本脚本同一事实源）
DEV_PORT="${PORT:-}"
if [ -z "$DEV_PORT" ]; then
  DEV_PORT="$(sed -nE 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*"?([0-9]+).*/\1/p' "$ROOT/.env" 2>/dev/null | head -1 || true)"
fi
DEV_PORT="${DEV_PORT:-8081}" # dev 服务器端口（dev-restart.sh 的就绪探测共用）

# 按「$ROOT.*<fragment>」匹配并停止本项目进程；SIGTERM 未响应则升级 SIGKILL
stop_by_pattern() { # <fragment> <label>
  local fragment="$1" label="$2" pattern
  pattern="$ROOT.*$fragment" # 注意：local 多变量同时声明时值还未生效，跨引用必须拆开赋值
  if ! pgrep -f "$pattern" >/dev/null 2>&1; then
    echo "ℹ️  $label 未在运行"
    return 0
  fi
  pkill -f "$pattern" 2>/dev/null || true
  sleep 1
  local note=""
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    pkill -9 -f "$pattern" 2>/dev/null || true
    sleep 1
    note="（SIGTERM 未响应，已强制结束）"
  fi
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    echo "❌ $label 未能停止，请手动检查: pgrep -f \"$pattern\""
    return 1
  fi
  echo "🗑️  已停止 $label$note"
  return 0
}

# 清掉占用端口的残留监听进程（如与父进程脱钩的 next-server）
free_port() { # <port>
  local port="$1"
  command -v lsof >/dev/null || return 0
  local pids
  pids=$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
    echo "🧹 已释放 :$port"
  fi
}

stop_dev() {
  stop_by_pattern "next dev" "dev 服务器"
  free_port "$DEV_PORT"
}

stop_worker() {
  stop_by_pattern "src/worker" "worker"
}

# 仅直接执行时运行；被 dev-restart.sh source 时只提供上面的函数
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-dev}" in
    dev) stop_dev ;;
    worker) stop_worker ;;
    all)
      rc=0
      stop_dev || rc=1
      stop_worker || rc=1
      exit "$rc"
      ;;
    *) echo "用法: $0 [dev|worker|all]"; exit 1 ;;
  esac
fi

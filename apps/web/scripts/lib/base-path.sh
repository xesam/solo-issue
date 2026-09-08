#!/usr/bin/env bash
# 部署 basePath 脚本侧解析器（dev-restart / verify-smoke / verify-all 共用）。
# 与 src/lib/base-path.ts 同语义：shell 环境变量 BASE_PATH 优先，缺则读 apps/web/.env，
# 仍缺回默认 /solo-issue（默认字面量与 ts 侧 DEFAULT_BASE_PATH 对齐维护）。
# 空串视同未设置；显式 "/" = 根路径部署（输出空串）；无前导斜杠自动补、尾部斜杠去除。
# 用法: source 本文件后调用 solo_base_path <应用根目录>，取全局 APP_BASE_PATH。
solo_base_path() { # <appRoot>
  local root="$1" raw
  raw="${BASE_PATH:-}"
  if [ -z "$raw" ] && [ -f "$root/.env" ]; then
    raw="$(sed -nE 's/^[[:space:]]*BASE_PATH[[:space:]]*=[[:space:]]*//p' "$root/.env" 2>/dev/null | head -1 || true)"
    # 与 dotenv 解析语义对齐：先去 CRLF/行内注释，再剥成对单双引号（顺序反了会剥不动尾引号）
    raw="${raw%%$'\r'}"
    raw="${raw%%[[:space:]]\#*}"
    raw="${raw%\"}"; raw="${raw#\"}"
    raw="${raw%\'}"; raw="${raw#\'}"
  fi
  # 与 dotenv 同语义的去两端空白（尾部带上斜杠后空格的输入，先裁干净再归一化）
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  if [ -z "$raw" ]; then raw="/solo-issue"; fi
  if [ "$raw" = "/" ]; then
    APP_BASE_PATH=""
    return
  fi
  # 归一化（与 ts 侧 normalize 同语义）：剥离全部首尾斜杠后补单个前导
  while :; do case "$raw" in /*) raw="${raw#/}" ;; *) break ;; esac; done
  while :; do case "$raw" in */) raw="${raw%/}" ;; *) break ;; esac; done
  APP_BASE_PATH="/$raw"
}

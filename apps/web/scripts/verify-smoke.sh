#!/usr/bin/env bash
# 部署后冒烟测试：健康检查 → 登录方式 → 会话 → 核心读接口（工作区/项目列表）
# 用法: ./scripts/verify-smoke.sh http://your-host:8081 [管理员邮箱]
#       BASE 传「服务根」即可——部署 basePath（默认 /solo-issue，可经 BASE_PATH 自定义）自动追加，
#       已含前缀则原样使用；邮箱缺省 solo-issue@github.com（seed 无 ADMIN_EMAIL 时的内建号默认）
set -euo pipefail

ROOT="${1:-${BASE_URL:-http://localhost:8081}}"
# basePath 解析与 src/lib/base-path.ts 同语义（shell env / .env / 默认，部署前缀可自定义）
source "$(dirname "${BASH_SOURCE[0]}")/lib/base-path.sh"
solo_base_path "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BP="$APP_BASE_PATH"
case "$ROOT" in
  *"$BP") BASE="$ROOT" ;;
  *)      BASE="$ROOT${BP}" ;;
esac
JAR=$(mktemp)
FAIL=0
trap 'rm -f "$JAR"' EXIT   # set -e 中途失败也要带走临时 cookie，不留痕

check() {
  local name="$1" expect="$2" actual="$3"
  if [ "$actual" = "$expect" ]; then
    echo "✅ $name ($actual)"
  else
    echo "❌ $name 期望 $expect 实得 $actual"; FAIL=1
  fi
}

# 1. 健康检查（含数据库连接）
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/health")
check "健康检查" 200 "$HEALTH"

# 2. 登录方式探测（企微入口状态）——只打印不算过，需要 200 + 合法 JSON 信封
#    实际形状 {"data":{"wecom":{…}}}（详见 /api/auth/providers 路由）
PROV=$(curl -s -w "\n%{http_code}" "$BASE/api/auth/providers")
PROV_CODE=$(echo "$PROV" | tail -1)
PROV_BODY=$(echo "$PROV" | sed '$d')
if [ "$PROV_CODE" = "200" ] && echo "$PROV_BODY" | grep -q '"wecom"'; then
  echo "✅ 登录方式可用（${PROV_BODY}）"
else
  echo "❌ 登录方式探测失败（${PROV_CODE}）: ${PROV_BODY}"; FAIL=1
fi

# 3. 未登录访问受保护接口 → 401
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/auth/me")
check "未登录 401" 401 "$UNAUTH"

# 4. 安全响应头（当前仅断言一条：nosniff；新增响应头时在此追加）
H=$(curl -sI "$BASE/api/health")
echo "$H" | grep -qi "x-content-type-options: nosniff" && echo "✅ 安全响应头 nosniff" || { echo "❌ 缺少 x-content-type-options: nosniff"; FAIL=1; }

# 5. 尝试开发登录 → 建项目级读链路
#    仅 403/404（已关闭）可放行；其余非 200（含 5xx）都是部署异常，必须红
#    邮箱参数化：seed 支持 ADMIN_EMAIL 后，默认值仅对上「未定制的内建号」；
#    定制部署传参 SMOKE_EMAIL 或第二位置参数（如 admin@yourcompany.com）
DEV_EMAIL="${SMOKE_EMAIL:-${2:-solo-issue@github.com}}"
DEV=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/auth/dev-login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$DEV_EMAIL\"}")
if [ "$DEV" = "200" ]; then
  # 会话有效性看 HTTP 状态码（curl 退出码只反映传输成功，401/500 能裸进）。
  # 403 是"强制改密"拦截——说明会话本身有效，视为通过（其他码一律红）
  ME_CODE=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/auth/me")
  if [ "$ME_CODE" = "200" ]; then
    echo "✅ 会话有效 (200)"
  elif [ "$ME_CODE" = "403" ]; then
    echo "✅ 会话有效 (403 = 强制改密拦截)"
    echo "ℹ️  略过核心读链路（强制改密态下业务 API 全部拦截）"
  else
    echo "❌ 会话有效 ($ME_CODE)"; FAIL=1
  fi

  # 核心读链路：工作区列表 → 项目列表（都用登录态打，验证 DB 读路径活着）
  if [ "$ME_CODE" = "200" ]; then
    WS=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/workspaces")
    check "我的工作区列表" 200 "$WS"
    if [ "$WS" = "200" ]; then
      PROJ=$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/api/workspaces/main/projects")
      check "项目列表" 200 "$PROJ"
    fi
  fi
elif [ "$DEV" = "403" ] || [ "$DEV" = "404" ]; then
  echo "ℹ️  开发登录已关闭（${DEV}）——生产环境这是正确状态；核心读链路需真实凭证，跳过"
else
  # ${DEV} 形式取值：全角字符紧跟 $VAR 时 macOS bash 3.2 会把后续多字节吞进变量名（unbound variable）
  echo "❌ 开发登录非预期状态 ${DEV}（仅 200/403/404 合法；5xx 属部署异常）"; FAIL=1
fi

if [ "$FAIL" = "0" ]; then echo "🎉 冒烟通过"; else echo "💥 存在失败项"; exit 1; fi

#!/usr/bin/env bash
# ui-guidelines 审计（判据 = 10 项检查全部通过；分节头与「✓ 全部通过（10/10）」汇总行属正常输出）。
# 检查项契约与命令说明见 docs/07-ui-guidelines.md §8
# 用法：bash scripts/audit-ui.sh
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# 审计用 grep：grep 的 exit 2（坏正则/不可读文件）是审计器自身故障，
# 必须当场红掉——否则 hits 为空、检查绿灯，审计器坏了也"全部通过"
gsrc() {
  local out st
  out=$(grep "$@") && st=0 || st=$?
  if [ "$st" -ge 2 ]; then
    echo "✗ 审计器自身故障：grep exit $st（规则失效，禁止放行）" >&2
    exit 2
  fi
  printf '%s' "$out"
}

echo "① 裸调色板（整段 Tailwind 调色板家族 ×任意前缀；白名单：src/components/ui/）"
hits=$(gsrc -rnE '(text|bg|border|ring|fill|stroke|divide|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]' src --include="*.tsx" \
  | grep -v "src/components/ui/" || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

# 排除 // 与块注释续行（" * "）两种注释形态——注释里出现不判罪，代码里出现一律报
echo "② emoji 图标（除整行两类注释外的一切出现均可命中；清单是常用集合，非全集）"
hits=$(gsrc -rn "📁\|🔔\|🎉\|🖼\|📄\|✅\|❌\|🚀\|🔥\|💡\|📌\|🔗\|⭐\|👏\|🎯\|📊\|⚠️\|👍\|👎" src --include="*.tsx" \
  | grep -vE '^[^:]+:[0-9]+: *(//|\*|/\*)' || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "③ 仅 title 无 aria-label 的交互元素（双向判定：title 前后 3 行内需有 aria-label）"
hits=$(python3 - <<'PY'
import glob, sys

bad = []
import re
for f in glob.glob("src/**/*.tsx", recursive=True):
    lines = open(f).readlines()
    for i, line in enumerate(lines):
        if 'title="' in line and "DialogTitle" not in line and "aria-label" not in line:
            # React 组件 prop（title="X" 所在元素为大写标签）非 HTML 提示属性：
            # 单行写法正则可达；多行 props 回看 8 行找同元素的大写开标签
            if re.search(r'<[A-Z][A-Za-z]*[^>]*\btitle="', line) or any(
                re.match(r'\s*<[A-Z][A-Za-z]*', lines[j])
                for j in range(max(0, i - 8), i + 1)
            ):
                continue
            window = "".join(lines[max(0, i - 3) : i + 4])
            if "aria-label" not in window and "ConfirmDialog" not in window:
                bad.append(f"{f}:{i+1}:{line.strip()}")
print("\n".join(bad))
PY
)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "④ 裸“加载中…”文本加载态（禁止新增；Skeleton 承担）"
hits=$(gsrc -rn "加载中…" src --include="*.tsx" \
  | grep -v "aria-label" \
  | grep -v "src/app/auth" \
  | grep -vE '^[^:]+:[0-9]+: *(//|\*)' || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "⑤ 手写弹层遮罩（弹窗一律 Radix Dialog/Popover；fixed inset-0 仅允许出现在 ui/ 基件与 auth 页；豁免只认路径，不认行内容）"
hits=$(gsrc -rn 'fixed inset-0' src --include="*.tsx" \
  | grep -v "src/components/ui/" \
  | grep -v "src/app/auth" || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "⑥ 原生 select（全站一律 shadcn Select；表单受控/选项不多不是理由）"
hits=$(gsrc -rn "<select" src --include="*.tsx" || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "⑦ 裸状态色 amber/emerald（U4 起一律走 success/warning 令牌；上游 ui/ 豁免）"
hits=$(gsrc -rnE '(text|bg|border|fill)-(amber|emerald)-[0-9]+' src --include="*.tsx" \
  | grep -v "src/components/ui/" || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "⑧ 任意字面量字号 text-[..]（U4 起四刻度：xs/sm/base|lg/xl；字面量一律禁止）"
hits=$(gsrc -rnE 'text-\[[^]]+\]' src --include="*.tsx" \
  | grep -v "src/components/ui/" || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "⑨ 圆角白名单（U4 起只允许 md/xl/full 及其方向变体；裸 rounded、sm、xs、none、lg、2xl、3xl 自定义长度均禁止；上游 ui/ 豁免）"
# token 级白名单：提取 rounded/-xxx 串，再剔除 md|xl|full（含 t/b/l/r/tr/… 方向前缀）——
# 方向性变体（rounded-t-sm 等）与字面量（rounded-[8px]）不逃逸
hits=$(gsrc -rnoE 'rounded(-[a-z0-9]+)*' src --include="*.tsx" \
  | grep -v "src/components/ui/" \
  | grep -vE ':[0-9]+:rounded(-(t|b|l|r|tl|tr|bl|br))?-(md|xl|full)$' || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

echo "⑩ space-y 越档（U4 起只允许 1/4/6：组内/组间/区块；自定义长度与其余步长均禁止；上游 ui/ 豁免）"
# token 级白名单：提取 space-y-N.M token，精确剔除 1/4/6——0/0.5/1.5/2/11 等全档无处逃
hits=$(gsrc -rnoE 'space-y-[0-9]+(\.[0-9]+)?|space-y-\[[^]]+\]' src --include="*.tsx" \
  | grep -v "src/components/ui/" \
  | grep -vE ':[0-9]+:space-y-(1|4|6)$' || true)
[ -n "$hits" ] && { echo "$hits"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "✓ 全部通过（10/10）"
else
  echo "✗ 存在违规项，见上" >&2
  exit 1
fi

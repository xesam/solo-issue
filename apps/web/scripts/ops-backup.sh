#!/usr/bin/env bash
# 数据库 + 附件 备份（建议 cron: 0 2 * * * /path/to/solo-issue/scripts/ops-backup.sh）
# 保留最近 7 份；产物在 ./backups/
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP=7
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# 1) 数据库（容器栈默认连接参数，如有改动请用环境变量覆盖）
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-solo_issue}"
# 探测与导出绑定同一个容器名：容器名来自 Compose 默认派生（克隆目录名 solo-issue
# → solo-issue-postgres-1）；项目目录改名 / 换 COMPOSE_PROJECT_NAME 时锚定失败会落
# else 分支——连不上本机库就红，切勿改回「子串探测 + 硬编码 exec」的组合
PDOCKER=$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^solo-issue-postgres-1$' || true)
if [ -n "$PDOCKER" ]; then
  echo "[backup] 通过 docker exec 导出数据库…"
  docker exec "$PDOCKER" pg_dump -U "$DB_USER" "$DB_NAME" \
    > "$BACKUP_DIR/db-$STAMP.sql"
else
  echo "[backup] 通过 pg_dump 导出数据库…"
  PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" \
    pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" \
    > "$BACKUP_DIR/db-$STAMP.sql"
fi

# 备份产物必须验明正身：pg_dump 部分失败/重定向踩空都可能留下空文件或错误文本，
# 按保留策略它反而排在最新被保留，挤掉上一份好的
DUMP="$BACKUP_DIR/db-$STAMP.sql"
if [ ! -s "$DUMP" ] || ! grep -q "CREATE TABLE" "$DUMP"; then
  echo "✗ 备份产物异常（空文件或无 CREATE TABLE，疑 dump 失败/空库/错库），已删除本份产物" >&2
  rm -f "$DUMP"
  exit 1
fi

# 2) 附件目录
if [ -d uploads ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" uploads
  echo "[backup] 附件已打包"
fi

# 3) 清理旧备份（删不动要吵出来：轮转失败意味着"保留 7 份"无人监督）。
# 注意 glob 无匹配时 ls 以 2 退出（stderr 已吞），|| true 护住——否则无附件产物的
# 部署每次备份都在清理段"失败"，cron 侧永远报错而备份本身其实是好的
ls -1t "$BACKUP_DIR"/db-*.sql 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do rm -f "$f" || echo "⚠️ 清理 $f 失败" >&2; done || true
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do rm -f "$f" || echo "⚠️ 清理 $f 失败" >&2; done || true

echo "[backup] 完成: $BACKUP_DIR (db-$STAMP.sql, $(du -h "$DUMP" | cut -f1))"

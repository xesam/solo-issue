# 部署与运维指南

> 适用：**单机部署**。两种等价路径——**A) Docker Compose**（推荐，app + worker + postgres 一键起）或 **B) 直接在服务器上运行**（Node 直跑 + 自备 PostgreSQL）；二者运行的是同一套应用，Docker 不是硬性依赖，真正的运行时前置只有一个 **PostgreSQL 实例**（15/16 均可；Compose 默认 `15-alpine`，可 `POSTGRES_TAG=16-alpine` 覆盖）。
> 需要 HTTPS、域名访问或接入企业微信时，须在应用前面加一层反向代理（见 §4）。本地开发见 [docs/README.md](README.md) §2；接企微（申请/配置/冒烟）见 [09-wecom-setup.md](09-wecom-setup.md)。

## 1. 部署前准备

### 1.1 环境要求

| 部署方式 | 需要准备 |
|---|---|
| Docker Compose（推荐） | 一台安装了 Docker 和 Docker Compose 的服务器，一个空闲端口（默认 8081） |
| 直接在服务器上运行 | Node.js 22 或更高版本、pnpm、PostgreSQL 15 或 16 |

### 1.2 域名和网络

- 只在内网使用时，用服务器 IP 访问即可，不需要域名
- 需要 HTTPS 时，准备域名和证书，并在应用前面加一层反向代理（见 §4）
- 需要接入企业微信时，必须有公网可访问的域名、固定的服务器出口 IP 和反向代理（见 [09-wecom-setup.md](09-wecom-setup.md)）

## 2. Docker Compose 部署（推荐）

### 2.1 下载源码

```bash
git clone https://github.com/xesam/solo-issue.git solo-issue
cd solo-issue
cp apps/web/.env.example apps/web/.env
```

目录名保持 `solo-issue`：Docker Compose 用目录名生成容器名，§8 的定时备份脚本依赖这个名称。

### 2.2 修改配置

编辑 `apps/web/.env`，至少设置以下几项：

```bash
# 管理员账号：仅在首次启动、还没有管理员时创建
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_INIT_PASSWORD=change-me-on-first-login

# 对外访问地址：必须包含部署前缀（与 BASE_PATH 一致，默认 /solo-issue；改前缀见 §5）
APP_URL=http://192.168.1.10:8081/solo-issue

# 用 http 加服务器 IP 访问（没有 HTTPS）时需要打开，否则登录后会被退回登录页
# ALLOW_INSECURE_COOKIES=1
```

其他常用配置：

```bash
# 服务器对外端口（默认 8081）
# APP_PORT=8081

# 在国内构建镜像时，取消下面三行注释可以加快依赖下载
# DEBIAN_MIRROR=mirrors.huaweicloud.com
# NPM_REGISTRY=https://registry.npmmirror.com
# PRISMA_MIRROR=https://registry.npmmirror.com/-/binary/prisma
```

### 2.3 启动服务

```bash
docker compose --env-file apps/web/.env up --build -d   # 起 postgres + migrate + app + worker
```

`--env-file` 不能省略（compose 的 `${VAR}` 插值不读 `apps/web/.env`，须显式指过去），否则上面的配置不会生效。启动过程会依次：

1. 启动 PostgreSQL 数据库
2. 建表，并创建管理员账号和默认工作区（migrate 服务跑 `db:deploy + db:seed`）
3. 启动应用和后台任务进程（worker）

- 种子幂等：已有数据不覆盖、不重建；管理员已存在时复用首个管理员（占位邮箱改过真实邮箱后不会另建二号管理员）
- 未设置 `ADMIN_INIT_PASSWORD` 时管理员无密码，三个登录入口全灭（密码登录无密码可用、企微未配置、开发登录 Compose 缺省关闭）——初次部署按 §2.2 样例设置它才有首登入口

### 2.4 验证部署

```bash
./apps/web/scripts/verify-smoke.sh http://192.168.1.10:8081
```

用浏览器打开 `http://192.168.1.10:8081/solo-issue`，用配置的管理员邮箱和密码登录（首登强制改密）。首次登录后：

1. 在管理台「用户 → 编辑」把占位邮箱改为真实邮箱（登录键可随时后置修正）
2. 在管理台创建其他用户，或者接入企业微信让同事直接登录（见 [09-wecom-setup.md](09-wecom-setup.md)）；确认有人能登录后再关闭开发登录

### 2.5 常用操作

```bash
docker compose logs -f app       # 查看应用日志
docker compose logs -f worker    # 查看后台任务日志
docker compose restart app worker   # 重启应用和后台任务
docker compose down              # 停止服务，数据保留
```

`docker compose down -v` 会同时删除数据库和附件，除非确定要清空所有数据，否则不要使用（升级时也勿对 `down` 加 `-v`）。

## 3. 直接在服务器上运行（不使用 Docker）

### 3.1 配置

```bash
git clone https://github.com/xesam/solo-issue.git solo-issue
cd solo-issue
cp apps/web/.env.example apps/web/.env
```

编辑 `apps/web/.env`：

```bash
DATABASE_URL=postgres://postgres:your-db-password@localhost:5432/solo_issue
APP_URL=http://192.168.1.10:8081/solo-issue
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_INIT_PASSWORD=change-me-on-first-login
```

PostgreSQL 用单独一个容器也完全可以（`docker compose up -d postgres` 只起库、应用裸跑），本地开发即此形态。

### 3.2 构建

```bash
pnpm install       # 安装全部依赖，后台任务进程需要开发依赖（tsx），不能只装生产依赖（Docker 镜像的 runner 阶段同理携带完整 node_modules）
pnpm db:deploy     # 建表（生产用 migrate deploy，勿用 migrate dev）
pnpm db:seed       # 创建管理员账号和默认工作区（幂等：已有数据不覆盖）
pnpm build         # 生产构建
```

### 3.3 启动

需要同时运行两个进程：

```bash
pnpm start     # 应用，监听 .env 的 PORT（默认 8081）
pnpm worker    # 后台任务：企业微信推送分发 + 清理过期登录（站内通知在应用事务内直写，不经它）
```

只启动应用、不启动后台任务时，站内通知正常，但企业微信消息不会发出。

- 附件默认落 `./uploads`（`UPLOAD_DIR` 可改）；该目录需在升级/迁移时保留，并在备份中覆盖（§8）

### 3.4 设为系统服务

用 systemd 管理两个进程，可以开机自启、异常退出后自动重启。创建 `/etc/systemd/system/solo-issue-app.service`：

```ini
[Unit]
Description=Solo Issue app
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/solo-issue
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

再复制一份为 `solo-issue-worker.service`，把 `ExecStart` 改为 `/usr/bin/pnpm worker`、`Description` 改一下即可。`pnpm` 的实际路径用 `which pnpm` 确认。应用启动时会自动读取 `apps/web/.env`，不需要在服务文件里重复配置。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now solo-issue-app solo-issue-worker
sudo systemctl status solo-issue-app solo-issue-worker
```

> `apps/web/scripts/dev-restart.sh` / `dev-stop.sh` 是**本地开发**用（跑 `pnpm dev` + nohup），**不用于生产**——生产请用 systemd 等进程管理器。

## 4. HTTPS 和反向代理

需要 HTTPS、域名访问或接入企业微信时，在应用前面加一层 Nginx 或 Caddy。Nginx 示例：

```nginx
server {
    listen 80;
    server_name issue.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name issue.example.com;

    ssl_certificate     /etc/nginx/certs/issue.example.com.pem;
    ssl_certificate_key /etc/nginx/certs/issue.example.com.key;

    # 附件上传大小限制，不小于 MAX_UPLOAD_MB（默认 10MB）；Nginx 默认只允许 1MB
    client_max_body_size 20m;

    # 前缀与部署的 BASE_PATH 一致（默认 /solo-issue；根路径部署用 location /）
    location /solo-issue {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # 用客户端真实地址覆盖，而不是追加，避免客户端伪造来源 IP
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配置反向代理后：

- `APP_URL` 改为 `https://issue.example.com/solo-issue`（前缀随部署的 `BASE_PATH`）
- 不要设置 `ALLOW_INSECURE_COOKIES`，保持 `TRUST_PROXY` 默认，不要设为 `0`（反代终结 TLS 时信任 XFF）
- 接入企业微信时，域名验证文件 `WW_verify_*.txt` 须由 Nginx 在域名根路径返回——应用挂在部署前缀之下，不响应裸根；配置方法见 [09-wecom-setup.md](09-wecom-setup.md)

## 5. 环境变量

| 变量 | 是否必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 直接运行时必填 | PostgreSQL 连接地址（裸机必填并指向你的 Postgres；Compose 已内置） |
| `APP_URL` | 必填 | 对外访问地址（IM 推送深链、OAuth 回调都以它为拼基）——**必须包含部署前缀（与 `BASE_PATH` 一致，默认 `/solo-issue`）**：本机 `http://localhost:8081/solo-issue`，线上 `https://<网关>/solo-issue`；未显式设置时代码按 `PORT` + basePath 推导。漏带前缀会让 IM 深链与企微回调 404 |
| `BASE_PATH` | 否 | 部署子路径（⚠️ **构建期配置**：改值须重新 `docker compose --build` / `pnpm build`，构建与运行保持同值）。默认 `/solo-issue`；设 `/` = 根路径部署；可自定义任意前缀。Docker Compose 经 build args 与运行 env 自动透传 |
| `PORT` | 否 | app 监听端口（默认 8081；Docker 场景由 `APP_PORT` 控制宿主机映射，容器内固定 3000） |
| `APP_PORT` | 否 | **仅 Docker**：Compose 宿主机映射端口（默认 8081；容器内固定 3000，改端口无需动容器） |
| `ADMIN_EMAIL` | 建议填写 | seed 管理员邮箱（缺省占位 `solo-issue@github.com`，上线后在管理台改为真实邮箱） |
| `ADMIN_INIT_PASSWORD` | 建议填写 | seed 时为管理员设初始密码（幂等：**管理员尚无密码**时生效、已有密码不覆盖，首登强制改密；不设则管理员无密码，见 §2.3） |
| `ALLOW_DEV_LOGIN` | 建议 false | 邮箱直登开关。生产默认关（403）；仅在初始化/救急时临时开 |
| `WECOM_CORP_ID` / `WECOM_AGENT_ID` / `WECOM_SECRET` | 正式上线需要 | 企业微信自建应用凭证：三件套齐备即自动从模拟切真实通道（接入与冒烟步骤见 [09-wecom-setup.md](09-wecom-setup.md)） |
| `ALLOW_IM_MOCK` | 建议 false | 模拟通道开关（未显式设置时默认 `NODE_ENV !== "production"`）；生产默认关 |
| `ALLOW_INSECURE_COOKIES` | 否 | 仅 http 环境（本地/无 TLS 联调）设 `1` 放行非 Secure Cookie；生产默认强制 Secure |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | 否 | 附件目录（Docker 内 /app/uploads，裸机默认 ./uploads）与单文件上限（默认 10MB） |
| `TRUST_PROXY` | 否 | 直暴端口、前面没有反向代理时设 `0`（不信任 XFF/X-Real-IP，归为 unknown）；有反向代理时保持默认 |
| `POSTGRES_TAG` | 否 | **仅 Docker**：Compose 的 postgres 镜像 tag（默认 `15-alpine`，可 `16-alpine`） |
| `POSTGRES_HOST/PORT/USER/DB/PASSWORD` | 否 | 备份脚本 `ops-backup.sh` 使用：`HOST/PORT` 仅本机 `pg_dump` 分支；**`USER/DB` 也作用于 docker exec 分支**（默认 localhost/5432/postgres/solo_issue/postgres） |
| `DEBIAN_MIRROR` / `NPM_REGISTRY` / `PRISMA_MIRROR` | 否 | **仅 Docker 构建**：镜像加速源（Debian apt / npm registry / Prisma 二进制，默认官方源，`.env.example` 有注释样例），参与 compose build args，对裸机部署无意义 |

## 6. 权限模型速览

三级行为口径：**GUEST 只读 → MEMBER 读写 → OWNER 管理**；超级管理员（`isAdmin`）只治理实例（建号/建工作区），不穿透业务数据。私有项目叠加「项目成员 ∪ 工作区负责人可见、项目级 GUEST 只读、字段与状态定义限项目负责人」。

> 完整能力矩阵（业务/治理/Agent 三面）的单一事实源见 [04-workspace-design.md](04-workspace-design.md) §9；企微登录的新用户自动加入工作区为 MEMBER。

## 7. 安全基线

| 项 | 状态 |
|---|---|
| 会话 | DB 会话 + httpOnly/SameSite=Lax Cookie，30 天过期，停用用户立即失效 |
| 会话清理 | worker 每小时清过期会话 |
| 登录入口限流 | dev-login 10 次/分/IP；企微 start/web-start 各 20 次/分、callback 30 次/分（内存实现） |
| CSRF | 写接口仅接受 `application/json`（表单跨站提交无法伪造） |
| 越权防护 | 全 API 走工作区成员校验；提及接收人校验成员资格；附件下载校验归属链 |
| OAuth state | 10 分钟短时票据（成功回调即销毁），回调校验防 CSRF/重放 |
| 响应头 | nosniff / SAMEORIGIN / Referrer-Policy / Permissions-Policy |
| 健康检查 | app 探活 basePath 之下的 `/api/health`（前缀随 `BASE_PATH`，默认部署即 `/solo-issue/api/health`，含数据库连通性）；Docker 场景由 Compose healthcheck 每 30s 探测 |

## 8. 备份与恢复

需要备份两部分：**数据库和附件**。手工命令适合单次/应急操作（§8.1）；定时备份用仓库自带的 `ops-backup.sh`（§8.2）。

### 8.1 手工备份与恢复

**Docker Compose 部署**——备份：

```bash
docker compose exec -T postgres pg_dump -U postgres solo_issue > backup-$(date +%Y%m%d).sql
docker compose cp app:/app/uploads ./uploads-$(date +%Y%m%d)
```

恢复（以 2026-10-26 的备份为例；postgres 容器保持运行，勿 `compose down`——down 会移除容器使后续 exec 失去目标）：

```bash
docker compose stop app worker                   # 停写保一致性
# 以下两行会删除当前数据库中的全部数据，执行前确认备份文件可用
docker compose exec -T postgres dropdb -U postgres solo_issue
docker compose exec -T postgres createdb -U postgres solo_issue
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d solo_issue < backup-20261026.sql
docker compose --env-file apps/web/.env up -d
docker compose cp ./uploads-20261026/. app:/app/uploads
```

**直接在服务器上运行**——备份：

```bash
pg_dump -h localhost -U postgres solo_issue > backup-$(date +%Y%m%d).sql
tar czf uploads-$(date +%Y%m%d).tar.gz -C /opt/solo-issue/apps/web uploads
```

恢复：

```bash
sudo systemctl stop solo-issue-app solo-issue-worker   # 非 systemd 托管则停掉 pnpm start/pnpm worker 进程
# 以下两行会删除当前数据库中的全部数据，执行前确认备份文件可用
dropdb -h localhost -U postgres solo_issue
createdb -h localhost -U postgres solo_issue
psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d solo_issue < backup-20261026.sql
tar xzf uploads-20261026.tar.gz -C /opt/solo-issue/apps/web
sudo systemctl start solo-issue-app solo-issue-worker
```

### 8.2 定时备份脚本（`ops-backup.sh`，两种部署通用）

```bash
./apps/web/scripts/ops-backup.sh                      # 手动备份（db + uploads）
crontab -e                               # 建议：0 2 * * * cd /path && ./apps/web/scripts/ops-backup.sh
```

- 脚本在 `apps/web` 内执行，产物固定落 `apps/web/backups/`（`db-<时间戳>.sql` + `uploads-<时间戳>.tar.gz`，归档内容前缀 `uploads/`），自动验真（空文件/缺 `CREATE TABLE` 即删并红）并保留最近 7 份
- 探测到 Compose 默认容器名 `solo-issue-postgres-1` 则走 `docker exec pg_dump`，否则回退本机 `pg_dump`（连接参数取 `POSTGRES_HOST/PORT/USER/DB/PASSWORD`，缺省 localhost/5432/postgres/solo_issue/postgres）。探测锚定**克隆目录名恰为 `solo-issue`**——目录改名或自定义 `COMPOSE_PROJECT_NAME` 时锚定失败落本机分支，须改用 `POSTGRES_*` 指向该容器映射出的 5432
- 裸机若 Postgres 在别的机器/非默认参数，先导出 `POSTGRES_*` 再跑；需保证 `pg_dump` 客户端版本 ≥ 服务端（不匹配会报版本错误）
- **Docker 部署的附件在命名卷（`uploads` volume）内**，本脚本只打包宿主仓库 `./uploads`——容器形态需另行 `docker run --rm -v solo-issue_uploads:/data -v "$PWD/apps/web/backups":/out alpine tar czf /out/uploads.tar.gz /data`，或把 compose 的 uploads 卷改为宿主 bind mount 让本脚本直接覆盖；相应地，用脚本产物恢复时附件须解回卷：

```bash
docker run --rm -v solo-issue_uploads:/data -v "$PWD/apps/web/backups":/out \
  alpine sh -c "tar xzf /out/uploads-XXXX.tar.gz -C /data --strip-components=1"
```

- 数据库恢复命令同 §8.1，只是把输入路径换成 `apps/web/backups/db-XXXX.sql`

## 9. 升级流程

升级前先备份（§8），然后 `git pull` 拉取新版本：

```bash
git pull
```

- **Docker Compose 场景**
  ```bash
  docker compose --env-file apps/web/.env up --build -d     # migrate 服务会自动跑新增迁移
  ./apps/web/scripts/verify-smoke.sh http://<host>:8081
  ```
- **直接在服务器上运行**
  ```bash
  pnpm install
  pnpm db:deploy                   # 应用新增迁移（幂等可重放）
  pnpm build
  systemctl restart solo-issue-app solo-issue-worker   # 或重启 pnpm start / pnpm worker
  ./apps/web/scripts/verify-smoke.sh http://<host>:8081
  ```

## 10. 排障与常见问题

### 10.1 登录后又回到登录页

浏览器没有保存登录状态。用 http（没有 HTTPS）访问时，在 `apps/web/.env` 中设置 `ALLOW_INSECURE_COOKIES=1` 并重启；正式使用建议配置 HTTPS（见 §4）。

### 10.2 收不到企业微信消息

1. 后台任务进程是否在运行：`docker compose logs worker`，或 `systemctl status solo-issue-worker`
2. `WECOM_CORP_ID`、`WECOM_AGENT_ID`、`WECOM_SECRET` 是否正确，服务器出口 IP 是否已加入企业微信的可信 IP
3. `APP_URL` 是否与部署前缀一致（默认 `/solo-issue`，随 `BASE_PATH`）
4. 接收人的账号是否通过企业微信登录过，以及是否在个人设置中关闭了这类推送

企微侧排障（登录页无企微入口/回调带 error）见 [09-wecom-setup.md](09-wecom-setup.md) §6。

### 10.3 忘记管理员密码

```bash
# Docker Compose 部署
docker compose exec app pnpm -C apps/web exec tsx scripts/ops-set-password.ts admin@yourcompany.com <新密码>

# 直接在服务器上运行
pnpm -C apps/web exec tsx scripts/ops-set-password.ts admin@yourcompany.com <新密码>
```

重置后该账号的所有登录都会失效，下次登录时要求修改密码。IM 建号（无邮箱）账号走「管理台补写邮箱 → 重置密码」，细节见 [03-auth.md](03-auth.md) §6。

### 10.4 附件 404

应用能否写到 `UPLOAD_DIR`：Docker 看 uploads 卷是否挂载（compose 已配，升级勿 down -v）；裸机看目录存在且进程有写权限。

### 10.5 健康检查失败

裸机确认 PostgreSQL 可达（`DATABASE_URL` 正确、库已 `db:deploy`）；Docker 看 app 容器日志与 postgres healthcheck。

### 10.6 升级后服务没有启动

Docker Compose 部署时先查看建表步骤的日志：

```bash
docker compose logs migrate
```

根据报错处理后重新执行 `docker compose --env-file apps/web/.env up -d`。

## 11. 下一步

- 接入企业微信：[09-wecom-setup.md](09-wecom-setup.md)
- 系统架构与设计取舍：[01-architecture.md](01-architecture.md)
- 让 AI 助手接入：[AGENTS.md](../AGENTS.md)

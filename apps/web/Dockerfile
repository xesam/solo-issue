# syntax=docker/dockerfile:1
# 多阶段构建：runner 携带完整 node_modules（worker 需 tsx、migrate 需要 prisma CLI）
# alpine(musl) 下 Node22 内置 SQLite 会报 disk I/O error，改用 glibc 基础镜像
# build context = 仓库根（compose: context . + dockerfile apps/web/Dockerfile）——
# pnpm workspace 的 frozen-lockfile 校验 importers 全集（根 + apps/web + packages/mcp），
# 根 package.json 缺位时干净环境直接 ERR_PNPM_OUTDATED_LOCKFILE，且 corepack shim
# 读不到 packageManager 会回落最新 pnpm，与生成锁的版本语义脱钩
FROM node:22-bookworm-slim AS base
# 构建参数：国内用户可通过 .env 或 --build-arg 覆盖，加速依赖下载
ARG DEBIAN_MIRROR=deb.debian.org
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PRISMA_MIRROR=
# 仅非官方源时替换 Debian 镜像
RUN if [ "$DEBIAN_MIRROR" != "deb.debian.org" ]; then \
        sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g; s|security.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
# postinstall 的 generate 跳过（build 阶段会正式 prisma generate）
# Prisma 引擎镜像必须用 ENV 注入（写 /etc/profile 对 RUN 的非登录 shell 不生效）；
# PRISMA_MIRROR 为空时 Prisma 把空串视同未设置，回退官方地址
ENV npm_config_registry=${NPM_REGISTRY} \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    PRISMA_ENGINES_MIRROR=${PRISMA_MIRROR} \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/mcp/package.json packages/mcp/
# 显式激活 packageManager 锁定的 pnpm：corepack shim 的 packageManager 读取
# 依赖 host 核心包版本行为，未命中时静默回落最新 pnpm，安装器版本不可控
RUN corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
# pnpm store 挂 buildkit 持久缓存卷：跨构建复用下载缓存，大幅加速重复构建
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS build
# basePath 为构建期配置：客户端内联值经 NEXT_PUBLIC_BASE_PATH 进入 bundle；
# .env 不进镜像上下文（.dockerignore），BASE_PATH 只能经 build args 透传
ARG BASE_PATH=
ENV NEXT_PUBLIC_BASE_PATH=${BASE_PATH}
# 空串时 base-path.ts 回退默认 /solo-issue（worker 等未打包进程运行期读 compose 注入的 BASE_PATH）
# next build 收集页面数据时会加载模块顶层的 env() 校验，注入占位 DATABASE_URL 通过构建；
# 运行时由 compose 注入真实值，env() 在运行进程内会重新校验
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY --from=deps /app ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm -C apps/web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm", "-C", "apps/web", "start"]

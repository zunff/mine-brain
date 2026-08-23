# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
# 国内构建时可传 --build-arg NPM_REGISTRY=https://registry.npmmirror.com
# ARG 必须声明在 stage 内部（FROM 之后），写在最前面是全局作用域，stage 里取不到值
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_REGISTRY=$NPM_REGISTRY

# ---- 依赖安装 ----
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm config set registry $NPM_REGISTRY && npm i -g pnpm@10 \
  && pnpm config set registry $NPM_REGISTRY && pnpm install --frozen-lockfile

# ---- 构建（standalone 输出）----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm config set registry $NPM_REGISTRY && npm i -g pnpm@10 && pnpm build

# ---- 运行 ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME /app/data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

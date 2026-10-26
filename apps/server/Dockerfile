# syntax=docker/dockerfile:1
# 一个镜像：Fastify 听 0.0.0.0:3000，生产环境直接返回 web 构建结果。
FROM node:22-bookworm-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV CI=true
RUN corepack enable
WORKDIR /app

FROM base AS server-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter=@unfold/server...

FROM base AS web-build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dto/package.json packages/dto/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter=@unfold/web...
COPY tsconfig.base.json ./
COPY packages/dto packages/dto
COPY apps/web apps/web
RUN pnpm --filter @unfold/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=server-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/packages/dto ./packages/dto
COPY --from=server-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=server-deps /app/apps/server/package.json ./apps/server/package.json
COPY packages/dto/src ./packages/dto/src
COPY apps/server/src ./apps/server/src
COPY apps/server/drizzle ./apps/server/drizzle
COPY --from=web-build /app/apps/web/dist ./apps/web/dist
WORKDIR /app/apps/server
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "src/index.ts"]

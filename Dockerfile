# Single image used by both `app` (panel-api + SPA) and `worker`.
# ───────────────────────── builder ─────────────────────────
FROM node:20-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Dummy URLs so `prisma generate` can resolve the datasource env at build time
# (no DB connection is made during generate).
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV LICENSE_DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wootrico/db run generate
RUN pnpm --filter @wootrico/license-server run generate
RUN pnpm --filter @wootrico/panel-web run build
RUN pnpm --filter @wootrico/panel-api run build
RUN pnpm --filter @wootrico/worker run build
RUN pnpm --filter @wootrico/license-server run build

# Slim: wipe node_modules and reinstall PRODUCTION-only deps (drops
# vite/esbuild/typescript/tsup and the SPA build libs — runtime libs are already
# bundled into the dist), then regenerate the Prisma clients. dist is preserved.
RUN find . -name node_modules -type d -prune -exec rm -rf '{}' + \
 && pnpm install --prod --frozen-lockfile \
 && pnpm --filter @wootrico/db run generate \
 && pnpm --filter @wootrico/license-server run generate

# ───────────────────────── runtime ─────────────────────────
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Bring the whole built workspace (node_modules incl. prisma CLI + generated client).
COPY --from=builder /app /app

EXPOSE 3000
# default command is the API; the worker overrides it in compose.
CMD ["node", "apps/panel-api/dist/server.cjs"]

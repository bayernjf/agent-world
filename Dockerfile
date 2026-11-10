# syntax=docker/dockerfile:1

# --- base -----------------------------------------------------------------
FROM node:24-alpine AS base
ENV PNPM_HOME=/usr/local/pnpm
ENV PATH=$PNPM_HOME:$PATH
# registry.npmjs.org drops TLS connections often enough from this network that
# installs fail at random; the mirror is a faithful copy of the same packages.
ENV npm_config_registry=https://registry.npmmirror.com
# corepack fetches pnpm itself and ignores npm_config_registry, so it needs its
# own switch; preparing it here keeps that download in the base layer.
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

# --- deps (layer-cached) --------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server/package.json packages/server/package.json
RUN pnpm install --frozen-lockfile

# --- build ----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
# pnpm links each workspace package's dependencies into its own node_modules;
# copying only the root one leaves `zod` unresolved inside packages/core.
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY . .
RUN pnpm --filter @agent-world/core --filter @agent-world/server build

# --- runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Same workspace-linking problem as in the build stage: without these, ESM
# resolution of `bcryptjs` and friends fails at container start.
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist

EXPOSE 8791
CMD ["node", "packages/server/dist/index.js"]

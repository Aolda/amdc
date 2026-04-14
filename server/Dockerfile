FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY server/package.json server/

RUN pnpm install --frozen-lockfile --filter @amdc/server

COPY tsconfig.base.json ./
COPY server/ server/

RUN pnpm --filter @amdc/server build

FROM node:20-slim AS production
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY --from=base /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=base /app/server/package.json server/
RUN pnpm install --frozen-lockfile --filter @amdc/server --prod
COPY --from=base /app/server/dist server/dist

EXPOSE 3001
CMD ["node", "server/dist/index.js"]

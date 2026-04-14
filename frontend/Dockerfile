FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/

RUN pnpm install --frozen-lockfile --filter @amdc/frontend

COPY tsconfig.base.json ./
COPY frontend/ frontend/

RUN pnpm --filter @amdc/frontend build

FROM node:20-slim AS production
WORKDIR /app
COPY --from=base /app/frontend/.next/standalone ./
COPY --from=base /app/frontend/.next/static ./frontend/.next/static
COPY --from=base /app/frontend/public ./frontend/public

EXPOSE 3000
CMD ["node", "frontend/server.js"]

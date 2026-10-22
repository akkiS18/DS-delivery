# DS Delivery backend: one long-lived Node.js process (Fastify API + Telegram polling + background workers).
# Node >= 24.7 is required (built-in Argon2id for restaurant passwords). No secrets are copied or baked in: configuration is
# supplied at run time through environment variables.
ARG NODE_IMAGE=node:24-bookworm-slim

# ---- build: full dependencies, Prisma client generation, TypeScript -> dist/
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Prisma's query engine needs OpenSSL; generating here (same base image as runtime) selects the matching engine binary.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Scripts stay ON in this stage: @prisma/engines' postinstall downloads the Linux schema-engine binary that `prisma migrate deploy` needs in the
# `migrate` image below (with --ignore-scripts it would be fetched lazily at run time, as the non-root user, into root-owned node_modules).
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# ---- miniapp: the Telegram Mini App web build. The backend serves it at /app/ (same origin as the API: one HTTPS URL, no CORS).
FROM ${NODE_IMAGE} AS miniapp
WORKDIR /app/apps/customer-miniapp
COPY apps/customer-miniapp/package.json apps/customer-miniapp/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/customer-miniapp ./
RUN npm run build

# ---- migrate: one-off job image (has the Prisma CLI + migrations). Used by `docker compose run --rm migrate`.
FROM build AS migrate
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime: production dependencies only
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# The generated client + engine binary (npm ci --ignore-scripts did not generate it).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=miniapp /app/apps/customer-miniapp/dist ./apps/customer-miniapp/dist
COPY prisma ./prisma
USER node
ENV HOST=0.0.0.0 PORT=4000
EXPOSE 4000
# Liveness only (never the database): a database outage must not make the orchestrator kill a healthy process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini forwards SIGTERM to node and reaps children, so `docker stop` triggers the graceful shutdown.
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/src/server.js"]

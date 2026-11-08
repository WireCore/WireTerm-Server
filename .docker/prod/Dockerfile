# ---------- Build Stage ----------
FROM docker.io/library/node:26-alpine AS builder

WORKDIR /app

# Prisma needs openssl to generate the client.
RUN apk add --no-cache openssl

# Dependencies first, so that Docker reuses the layer when package-lock.json
# is unchanged. `postinstall` calls `prisma generate` and needs the schema for
# that. The ERD generator (mermaid-cli, puppeteer) stays off: ERD.md is only
# produced during development.
ENV DISABLE_ERD=true \
    PUPPETEER_SKIP_DOWNLOAD=true
COPY package*.json prisma.config.ts ./
COPY prisma/ ./prisma
RUN npm ci

# Copy the sources and build (tsc + tsc-alias + mail templates into dist/).
COPY . .
RUN npm run build

# ---------- Production Stage ----------
FROM docker.io/library/node:26-alpine

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

# Only the production dependencies, without install scripts: the Prisma
# client is already compiled into dist/, `prisma generate` is not needed here.
# Prisma itself is among the regular dependencies so that `prisma migrate
# deploy` can run from this image (before the server starts, or in an init
# container); `prisma.config.ts` and the migrations directory belong to that.
COPY package*.json prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Fetch Prisma's schema engine now, while still root: the container runs as
# `node` and could not write it into node_modules on the first migration.
RUN npx prisma version >/dev/null

# Built app from the build stage (including dist/templates and the generated
# Prisma client under dist/generated).
COPY --from=builder /app/dist ./dist

# Runs as `node`, not root. Port 80 (the default) is below 1024, so node gets
# the one capability it takes to bind it — nothing else.
RUN apk add --no-cache libcap \
    && setcap cap_net_bind_service=+ep "$(command -v node)" \
    && apk del libcap
USER node

EXPOSE 80

CMD ["node", "dist/server.js"]

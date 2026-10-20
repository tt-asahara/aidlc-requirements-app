FROM node:24.18.0-bookworm-slim AS cli
RUN npm install --global @anthropic-ai/claude-code@2.1.304

FROM oven/bun:1.3.14-debian
COPY --from=cli /usr/local /usr/local
RUN apt-get update && apt-get install -y --no-install-recommends git chromium chromium-sandbox fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN bun install --frozen-lockfile
COPY aidlc.lock.json ./
COPY scripts/fetch-aidlc.ts ./scripts/fetch-aidlc.ts
COPY apps/server/src/workspace/aidlc.ts apps/server/src/workspace/command.ts ./apps/server/src/workspace/
RUN bun scripts/fetch-aidlc.ts
COPY . .
RUN bun run build \
    && mkdir -p /var/lib/aidlc-app && chown bun:bun /var/lib/aidlc-app \
    && chown -R bun:bun /app/.cache/aidlc-src
ENV PORT=8787 WEB_PORT=8787 AIDLC_APP_BIND_ADDRESS=0.0.0.0 AIDLC_APP_SERVE_WEB=1 \
    AIDLC_APP_DATA_DIR=/var/lib/aidlc-app UI_POC_BROWSER_EXECUTABLE=/usr/bin/chromium
USER bun
EXPOSE 8787
CMD ["bun", "--no-env-file", "apps/server/src/index.ts"]

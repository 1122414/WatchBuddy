FROM node:22-bookworm-slim

ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=8787 \
    WATCHBUDDY_STATE_FILE=/data/watchbuddy-state.json

WORKDIR /app

COPY package.json ./
COPY apps/watchbuddy-api ./apps/watchbuddy-api
COPY packages/companion-core ./packages/companion-core
COPY packages/watch-pet-format ./packages/watch-pet-format
COPY scripts/validate-watch-pet-bundle.mjs ./scripts/validate-watch-pet-bundle.mjs
COPY assets/pets/watchbuddy-sprout/watch-lite ./assets/pets/watchbuddy-sprout/watch-lite

RUN mkdir -p /data \
    && chown -R node:node /data

USER node

EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "apps/watchbuddy-api/src/server.js"]

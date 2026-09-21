FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY services/render-worker ./services/render-worker

RUN npm ci --omit=dev --ignore-scripts

ENV NODE_ENV=production
EXPOSE 8200

USER node

CMD ["node", "--experimental-transform-types", "services/render-worker/src/main.ts"]

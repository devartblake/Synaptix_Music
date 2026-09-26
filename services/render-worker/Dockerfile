FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The base image bundles npm 10; the repository's lockfile and engines require npm 11.
RUN npm install --global npm@11.4.2

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY services/render-worker ./services/render-worker

RUN npm ci --omit=dev --ignore-scripts

ENV NODE_ENV=production
EXPOSE 8200

USER node

CMD ["node", "--experimental-transform-types", "services/render-worker/src/main.ts"]

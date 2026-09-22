FROM node:22-bookworm-slim

WORKDIR /app
RUN npm install --global npm@11.4.2

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY services/render-worker/package.json ./services/render-worker/package.json
RUN npm ci --no-audit --no-fund && chown -R node:node /app

ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
USER node

CMD ["npm", "run", "dev", "--workspace=@synaptix/music-studio", "--", "--hostname", "0.0.0.0"]

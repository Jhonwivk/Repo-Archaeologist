FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm ci && npm run build

ENV PORT=3001
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]

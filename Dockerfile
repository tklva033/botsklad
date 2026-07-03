FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY database ./database
COPY data ./data
COPY docs ./docs
COPY scripts ./scripts
COPY src ./src
COPY README.md ./

RUN mkdir -p /app/uploads /app/reports /app/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]

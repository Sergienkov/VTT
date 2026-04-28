FROM oven/bun:1.3.13-alpine

WORKDIR /app

COPY server/package.json ./
RUN bun install --production

COPY server/src ./src

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["bun", "src/index.ts"]

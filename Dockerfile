FROM oven/bun:1-alpine
WORKDIR /app
COPY dist/index.ts ./index.ts
ENV NODE_ENV=production
CMD ["bun", "index.ts"]

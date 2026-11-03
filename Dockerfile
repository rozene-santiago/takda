# Server version of the scheduler (logins, shared data).
# Used by docker-compose.yml and by Render (render.yaml).
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --filter @template/web
WORKDIR /app/packages/web
RUN bunx vite build

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app ./
WORKDIR /app/packages/web
RUN mkdir -p data
ENV NODE_ENV=production PORT=4200
EXPOSE 4200
CMD ["bun", "src/server.ts"]

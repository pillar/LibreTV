# 第一阶段：构建网站到 dist/（需要开发依赖中的 Tailwind 等工具）
FROM node:lts-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# 第二阶段：只包含服务端代码、生产依赖与 dist/
FROM node:lts-alpine
LABEL description="PlayAny TV - 免费在线视频搜索与观看平台"
ENV PORT=8080
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server.mjs ./
COPY lib ./lib
COPY --from=build /app/dist ./dist

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/manifest.json').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
USER node
CMD ["node", "server.mjs"]

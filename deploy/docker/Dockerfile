# 后端镜像：基于 Node.js 20 Alpine
# 构建上下文应为仓库根目录：
#   docker build -f deploy/docker/Dockerfile -t gasstoplist:latest .

FROM node:20-alpine AS deps
WORKDIR /app
# 仅拷贝依赖描述以最大化 docker 层缓存命中
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app

# 非 root 运行（与系统中的 nobody/65534 错开，避免和宿主权限冲突）
RUN addgroup -g 10001 -S poker \
 && adduser  -u 10001 -S -G poker poker

COPY --from=deps /app/node_modules ./node_modules
COPY server/index.js ./index.js

# 容器内数据目录由 volume 提供
RUN mkdir -p /app/data && chown -R poker:poker /app
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3840

USER poker
EXPOSE 3840

# 用 Node 内置 http 做健康检查，无需额外二进制
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]

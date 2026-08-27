FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Ponto de montagem dos documentos. Precisa existir e pertencer ao usuario `app`
# ANTES do volume ser montado: se o provedor montar sobre um diretorio do root,
# o primeiro upload falha com EACCES — e falha no upload de um cliente, nao no
# deploy. `STORAGE_LOCAL_DIR=/data/uploads` aponta para ca.
RUN mkdir -p /data/uploads && chown -R app:app /data
VOLUME ["/data"]
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx typeorm -d dist/data-source.js migration:run && node dist/main.js"]

FROM node:22-alpine

RUN apk add --no-cache mysql-client zip

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/        ./src/
COPY scripts/    ./scripts/
COPY docs/       ./docs/
COPY test/       ./test/
# config.json se monta como volumen read-only en docker-compose
# para poder editar roles sin reconstruir la imagen

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
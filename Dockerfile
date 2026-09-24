FROM node:22-alpine AS build
WORKDIR /app

# Cache dependencies separately from application code and paintings.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY tests ./tests
COPY public ./public
RUN npm run build

FROM nginx:stable-alpine AS production
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

FROM node:22-alpine AS api
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY src/game ./src/game
ENV REPLAY_DB_PATH=/data/replays.sqlite
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "--experimental-sqlite", "server/index.ts"]

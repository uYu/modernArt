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

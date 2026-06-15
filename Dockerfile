# Cloud Run / herhangi bir container host için (Firebase App Hosting'e alternatif).
# Çok aşamalı build: önce derle, sonra yalın üretim imajı.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Çalışma zamanında Cloud Run PORT'u enjekte eder; sunucu process.env.PORT okur.
EXPOSE 8080
CMD ["node", "dist/server.cjs"]

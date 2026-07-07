# Stage 1: build React frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production runtime
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci --only=production && \
    apk del python3 make g++
COPY --from=frontend /app/dist ./dist
COPY server ./server
EXPOSE 3003
CMD ["node", "server/index.js"]

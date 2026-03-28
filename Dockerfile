FROM node:18-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/database ./database
COPY --from=builder /app/schema ./schema

# Create directory for SQLite database
RUN mkdir -p /app/database

ENV NODE_ENV=production
ENV DATABASE_URL=/app/database/calro.db
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]

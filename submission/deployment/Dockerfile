# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run db:init
RUN npm run typecheck

EXPOSE 3001 5173

ENV PORT=3001
ENV HOST=0.0.0.0
ENV DATABASE_PATH=data/hostel.db
ENV UPLOADS_DIR=uploads

CMD ["npm", "run", "dev:all"]

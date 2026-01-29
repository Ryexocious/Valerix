FROM oven/bun:latest

WORKDIR /app

COPY package.json ./
COPY bun.lock ./

COPY package.json ./

COPY package.json bun.lock* ./

RUN bun install

# COPY prisma ./prisma
# RUN bunx prisma generate

COPY src ./src
COPY tsconfig.json ./

EXPOSE 3000
CMD ["bun", "run", "src/app.ts"]

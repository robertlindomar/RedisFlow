FROM node:22-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencias AS compilacao
COPY tsconfig.json next-env.d.ts next.config.ts ./
COPY src ./src
ENV NEXT_TELEMETRY_DISABLED=1 GERAR_DOCKER=1
RUN npm run build

FROM node:22-alpine AS aplicacao
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=compilacao --chown=node:node /app/.next/standalone ./
COPY --from=compilacao --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

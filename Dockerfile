FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

# Run as the unprivileged "node" user that ships with the image.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Apply any pending database migrations, then start. Migrations are guarded by a
# Postgres advisory lock, so it is safe if several instances start at once.
CMD ["sh", "-c", "node scripts/migrate.js && exec node server.js"]

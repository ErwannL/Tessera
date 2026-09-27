# ---- deps: every workspace dependency, from the lockfile only ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY examples/demo-app/package.json examples/demo-app/
COPY e2e/package.json e2e/
RUN npm ci --no-audit --no-fund

# ---- dev: tooling image (tests, lint, coverage, hot reload) ----
FROM deps AS dev
COPY . .
CMD ["npm", "run", "test:all"]

# ---- build: frontend bundle and compiled backend ----
FROM dev AS build
RUN npm run build -w frontend && npm run build -w backend

# ---- prod-deps: backend runtime dependencies only ----
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY examples/demo-app/package.json examples/demo-app/
COPY e2e/package.json e2e/
RUN npm ci --no-audit --no-fund --omit=dev --workspace backend --include-workspace-root=false

# ---- runtime: minimal image, non-root, no secret ----
FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root backend/package.json ./backend/package.json
COPY --from=build --chown=root:root /app/backend/dist ./backend/dist
COPY --from=build --chown=root:root /app/frontend/dist ./frontend/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/livez').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "backend/dist/main.js"]
CMD ["serve"]

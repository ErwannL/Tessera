# Playwright runner for the end-to-end suite (browsers preinstalled in the base image).
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY examples/demo-app/package.json examples/demo-app/
COPY e2e/package.json e2e/
RUN npm ci --no-audit --no-fund --workspace e2e --include-workspace-root=false
COPY e2e ./e2e
WORKDIR /app/e2e
CMD ["npx", "playwright", "test"]

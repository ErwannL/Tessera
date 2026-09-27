# Every target runs through Docker: Docker (with Compose) is the only requirement.
.PHONY: up down logs test coverage e2e lint build smoke

PROFILE ?=
PROFILE_FLAG = $(if $(PROFILE),--profile $(PROFILE),)

up: ## Start Tessera + PostgreSQL (PROFILE=demo adds the demo App)
	sh scripts/up.sh $(PROFILE_FLAG)

down: ## Stop the development stack
	docker compose --profile demo down

logs: ## Follow the development logs
	docker compose --profile demo logs -f

test: ## All backend and frontend tests, in Docker, with a disposable PostgreSQL
	sh scripts/in-docker.sh npm run test:all

coverage: ## Tests with coverage; fails under 100% for any file
	sh scripts/in-docker.sh npm run coverage:all

lint: ## ESLint, Prettier and TypeScript
	sh scripts/in-docker.sh npm run lint:all

e2e: ## Playwright against a disposable full stack
	sh scripts/e2e.sh

build: ## Production image
	docker build --target runtime -t tessera:latest .

smoke: build ## Production image: non-root, migrations, /health
	sh scripts/smoke.sh

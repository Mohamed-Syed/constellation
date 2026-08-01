# ---------------------------------------------------------------------------
# Constellation — local Docker workflow shortcuts (Atlas, round 2).
#
# Thin wrappers over `docker compose`; nothing here hides anything you
# couldn't type yourself. Requires Docker Desktop / Docker Engine with the
# Compose v2 plugin. On Windows, run from Git Bash or WSL.
# ---------------------------------------------------------------------------

COMPOSE ?= docker compose
# P3 federation overlay: base stack + federated tools, gated behind the
# "federation" compose profile so nothing extra starts by accident.
FED_COMPOSE ?= docker compose -f docker-compose.yml -f docker-compose.federation.yml --profile federation

.DEFAULT_GOAL := help
.PHONY: help up down logs migrate config build restart ps psql redis-cli health clean \
        fed-config fed-up fed-down fed-clean fed-ps fed-logs fed-health

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

config: ## Validate + render the resolved compose configuration
	$(COMPOSE) config

build: ## Build the api + web images
	$(COMPOSE) build

up: ## Build if needed and start the full stack in the background
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  portal  -> http://localhost:$${WEB_HOST_PORT:-3000}"
	@echo "  api     -> http://localhost:$${API_HOST_PORT:-4000}/api/health"
	@echo "  docs    -> http://localhost:$${API_HOST_PORT:-4000}/api/docs"

down: ## Stop the stack (named volumes are PRESERVED)
	$(COMPOSE) down --remove-orphans

clean: ## Stop the stack and DELETE the postgres/redis volumes (destructive)
	$(COMPOSE) down --remove-orphans --volumes

restart: ## Recreate the api + web containers without touching the databases
	$(COMPOSE) up -d --build --force-recreate --no-deps api web

ps: ## Show container status and health
	$(COMPOSE) ps

logs: ## Tail logs from every service (Ctrl-C to stop)
	$(COMPOSE) logs -f --tail=100

migrate: ## Apply the Prisma schema to the running Postgres
	# `migrate deploy` needs a committed prisma/migrations history. Until one
	# exists (round 1 shipped schema.prisma but never ran `migrate dev`),
	# `db push` is what actually creates the `core` schema — same thing the
	# api entrypoint does on boot.
	@if [ -d apps/api/prisma/migrations ] && [ -n "$$(ls -A apps/api/prisma/migrations 2>/dev/null)" ]; then \
		$(COMPOSE) exec api npx --no-install prisma migrate deploy; \
	else \
		echo "no prisma/migrations yet -> prisma db push"; \
		$(COMPOSE) exec api npx --no-install prisma db push --accept-data-loss; \
	fi

health: ## Curl the core health endpoint
	@curl -fsS http://localhost:$${API_HOST_PORT:-4000}/api/health && echo ""

psql: ## Open a psql shell on the platform database
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-constellation} -d $${POSTGRES_DB:-constellation}

redis-cli: ## Open a redis-cli shell
	$(COMPOSE) exec redis redis-cli

# ---------------------------------------------------------------------------
# P3 — portal federation (Keycloak SSO, Caddy proxy, Grafana/Prometheus/Loki,
# Open WebUI, Langflow). Opt-in: these targets are the ONLY way this stack
# starts, and it is heavy (several GB of RAM — expect a slow first pull).
# ---------------------------------------------------------------------------

fed-config: ## Validate the base + federation compose configuration
	$(FED_COMPOSE) config

fed-up: ## Start the base stack PLUS all federated tools (heavy)
	$(FED_COMPOSE) up -d
	@echo ""
	@echo "  one origin  -> http://localhost:$${PROXY_HOST_PORT:-8080}"
	@echo "    portal       /"
	@echo "    api          /api/health"
	@echo "    keycloak     /auth        (admin: $${KEYCLOAK_ADMIN:-admin})"
	@echo "    grafana      /tools/grafana"
	@echo "    open webui   /tools/chat"
	@echo "    langflow     /tools/langflow"
	@echo ""
	@echo "  first boot takes a few minutes; watch with 'make fed-ps'."

fed-down: ## Stop the federation stack (volumes PRESERVED)
	$(FED_COMPOSE) down --remove-orphans

fed-clean: ## Stop it and DELETE all federation volumes (destructive)
	$(FED_COMPOSE) down --remove-orphans --volumes

fed-ps: ## Show federation container status and health
	$(FED_COMPOSE) ps

fed-logs: ## Tail logs from the federation services
	$(FED_COMPOSE) logs -f --tail=100

fed-health: ## Probe every federated endpoint through the reverse proxy
	@base="http://localhost:$${PROXY_HOST_PORT:-8080}"; \
	for path in /api/health /auth/health/ready /tools/grafana/api/health /tools/chat/health /tools/langflow/health; do \
		code=$$(curl -s -o /dev/null -w '%{http_code}' "$$base$$path" || echo "---"); \
		printf '  %-34s %s\n' "$$path" "$$code"; \
	done

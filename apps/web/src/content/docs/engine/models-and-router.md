# Models & the model router

> Which models are available, how the router picks one, what happens when a provider fails, and how cost is accounted.

## The model providers

Constellation ships three model providers behind one interface. The router's `providers[0]` is the **default model** for any task that does not name a model, and the **failure fallback** when a named provider fails.

| Provider | Default model | Notes |
|---|---|---|
| **DeepSeek** (direct API) | `deepseek-v4-flash` | Primary default. Requires `DEEPSEEK_API_KEY` in `.env`. Fast and cheap. |
| **OpenRouter** | `openai/gpt-oss-120b` | Secondary. One `OPENROUTER_API_KEY` unlocks many models (GPT-OSS, Qwen, DeepSeek, Claude, …). |
| **Ollama** | local, e.g. `qwen2.5-coder` | Local and $0. **Stopped by default on the reference host** (operator decision); the router honestly reports it unreachable until restarted. Needed for local embeddings (Brain search). |

> **NOTE:** If no API keys are configured, the router still works — the default provider degrades honestly and nothing crashes. The platform keeps its $0/local invariant.

## Picking a model

- **Per task**: use the model picker in the Engine "New task" form, or send `"model": "..."` in the API.
- **Model ids**: bare ids work (`deepseek-v4-flash`, `openai/gpt-oss-120b`). Composite ids like `deepseek:deepseek-v4-flash` are **normalized** automatically before the API call.
- **By default**: no model → `providers[0]` (`deepseek-v4-flash`).

## Routing & fallback

1. The router asks each provider `canHandleModel(model)`.
2. A match wins; if the named provider is not configured, the task falls back to the default provider with the default model.
3. If a provider call fails transiently (5xx, network, timeout), the engine retries with backoff (`ENGINE_MODEL_RETRIES`, default 3).
4. Terminal failures (4xx — e.g. unknown model) fail the task honestly.

## Cost & usage accounting

- Every task records **inputTokens, outputTokens, and costUSD** from the provider's real pricing (e.g. a one-step DeepSeek task costs about `$0.000025`).
- **Compare** uses the same numbers for side-by-side A/B (see **Compare**).
- **Crews** aggregate descendants' tokens/cost onto the root (see **Crews & delegation**).
- A per-task token budget (`maxTokens`) caps runaway loops.

## Engine health

`GET /api/engine/health` reports the live router state — for each provider: name, model, and `reachable: true/false` with the real reason (e.g. `Ollama unreachable at http://localhost:11434`). The portal **Health** page renders the same data and refreshes automatically.

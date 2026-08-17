# Compare — multi-model A/B

> Run the same prompt against two or more models side by side and see latency, tokens, cost, and a quality score — the data you need to pick the right model for a task type.

## How to compare

1. Open **Compare** (`/compare`).
2. Enter a **prompt**.
3. Pick **two or more models** (e.g. `deepseek-v4-flash` and `openai/gpt-oss-120b`).
4. Click **Run**.

Each model runs the same prompt as a real engine task, and the page shows, per model:

| Column | Meaning |
|---|---|
| Model | The model id actually used |
| Latency | Wall-clock time for the run |
| Tokens | Input + output tokens (persisted on the task) |
| Cost | Real cost USD from provider pricing |
| Quality | A deterministic heuristic score (0–100 + label) |

## The quality score

`scoreQuality()` combines terminal success, substantive length, and coherence (run-on/blob penalties) into a 0–100 score with a label:

| Score | Label |
|---|---|
| 90–100 | Excellent |
| 75–89 | Good |
| 50–74 | Adequate |
| 25–49 | Thin |
| 0–24 | Failed |

> **NOTE:** The quality score is a **heuristic** — cheap, deterministic, and zero-cost. It ranks outputs, but it is not a semantic judge. The documented roadmap item is a semantic LLM-judge tier that actually reads the outputs.

## What it's for

- Choosing a default model for a task family (fast + cheap vs. capable).
- Catching regressions after a model/provider change.
- Building the historical usage/cost data that the platform's optimization tier will learn from.

## Result details

Each result card includes the full agent output and links back to the underlying task, so you can inspect the step history and verify the result is real (not just a score).

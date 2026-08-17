# Quick start — your first task in five minutes

> The fastest path from sign-in to a completed agent task, with every click spelled out.

## 1. Open the portal

1. Start the application (see **Deployment** for the full instructions):
   - API on `:4001` — `bash scripts/boot-api-v0.3.sh` (from the repo root)
   - Portal on `:3005` — `cd apps/web && npx next start -p 3005`
2. Open **http://localhost:3005** in a browser.
3. Sign in with the default administrator account:
   - Email: `admin@constellation.local`
   - Password: `changeme`

> **NOTE:** If the credentials were changed for your installation, use yours. The viewer (read-only) account is `viewer@constellation.local` / `changeme`.

## 2. Go to the Engine

1. In the left sidebar, click **Engine** (the box/terminal icon, under the *Platform* group).
2. On the engine page you see the task table. Click the **New task** button (top right of the page).
3. Fill in the form:
   - **Title** — e.g. `My first task`
   - **Prompt** — e.g. `Reply with exactly: hello from constellation`
   - **Model** — pick `deepseek-v4-flash` from the model list (the default provider).
   - **Max steps** — leave the default (or set `3`).
4. Click **Submit**.

## 3. Watch it run

- The task appears in the table with status `queued`, then `running`.
- The **step history** streams live (a small *live* badge pulses): each step shows the agent's thought, the tool call, and the tool result.
- A typical one-step task completes in a few seconds.

## 4. Read the result

1. Click the task row (or the **Details** action) to open the task detail dialog.
2. The **Result** panel shows the agent's final output as JSON.
3. Use **Copy** to put the result on your clipboard.

## 5. What you just proved

- A real model provider (DeepSeek by default) received your prompt.
- The durable queue persisted the task; the worker picked it up; the ReAct loop ran; usage and cost were recorded.
- The result, token counts, and cost are stored on the task record.

## Next steps

- Try the **model picker** with a different model (see **Models & the model router**).
- Run the same prompt against two models side by side on **Compare**.
- Schedule it to run every minute (see **Scheduler**).
- Watch the platform heal itself (see **AI Controller**).

# Skills — one-click automation recipes

> The skill marketplace: install a packaged automation recipe and it becomes a real scheduled task on the platform. No code, no restart.

## What a skill is

A skill is a curated recipe — a title, a description, a category, and a prompt — packaged by the platform. **Installing a skill creates a real `skill:<id>` cron schedule** that runs its prompt on the configured cadence.

## The catalog

The platform ships a built-in catalog (e.g. ops digests, monitoring briefings, and similar recipes). Each card shows:

- title + description,
- category chip,
- the cron expression it installs,
- its state (installed / available) and next run.

## Installing

1. Open **Skills** (`/skills`).
2. Click **Install** on a skill card.
3. The platform creates the schedule (`skill:<id>`) — check **Schedules** to see the real cron row with `runCount`.

## Managing installed skills

| Action | Effect |
|---|---|
| **Resume / Pause** | Enables / disables the underlying schedule (toggling is reflected immediately) |
| **Uninstall** | Removes the schedule and returns the skill to the available list |

## How it fits

- Skills are the no-code entry point to the **Scheduler** — everything they do, you can do by hand with a schedule (see **Scheduler**).
- Each skill run is a normal engine task: it appears in the Engine, has steps and a result, and costs real tokens (visible in usage/cost).

## RBAC

Skill *management* (install/uninstall) is admin-gated (`core:skill`-family / admin); browsing the catalog is available to signed-in users. A viewer sees the catalog but gets 403 on install.

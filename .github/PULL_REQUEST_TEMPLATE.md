<!-- Thanks for contributing to Constellation! Please fill this out so reviewers can move fast. -->

## What & why

<!-- What does this change do, and why? Link any related issue (e.g. "Closes #123"). -->

## Type of change

- [ ] 🐛 Bug fix
- [ ] ✨ New feature / capability
- [ ] 🧩 New or updated plugin
- [ ] 📖 Documentation
- [ ] ♻️ Refactor / chore
- [ ] 🔒 Security

## How I verified it

<!-- The project's rule: LIVE PROOF beats green tests. -->

- [ ] Ran the full gate: `./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1` (20/20 green)
- [ ] Added/updated tests for the change
- [ ] **For observable changes**, exercised it against real infrastructure — describe what you saw:

<!-- e.g. "Booted the API on :4001 with Postgres+Redis, submitted a task, watched it complete;
     endpoint returned 200 with the expected payload." Paste literal evidence where useful. -->

## Checklist

- [ ] No secrets committed (`.env` stays git-ignored; swept for keys/tokens)
- [ ] No `import type` used for an injected class or `@Body()` DTO (it silently breaks DI/validation)
- [ ] Services still degrade gracefully with no DB / no Redis where relevant
- [ ] SDK changes (if any) are additive + version-bumped and called out
- [ ] Docs updated where behavior or configuration changed

## Known gaps / follow-ups

<!-- Anything intentionally not done, or a honest "not verified live" note. -->

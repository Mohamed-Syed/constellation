# Design Skill — Constellation Portal

**What this is.** A working, committed record of the design guidance adopted for
the Constellation portal from three open-source "AI design taste" skill repos.
Any agent (Polaris, clau_partner, or a subagent) reshaping the portal should read
this before touching UI code so the design stays coherent and doesn't regress
into "AI slop."

**Source repos (installed as guidance + dependency on 2026-08-03):**
- [`emilkowalski/skills`](https://github.com/emilkowalski/skills) — Emil Kowalski (ex-Vercel/Linear), MIT.
  Animation decisions, easing curves, component micro-detail. Cloned to `/tmp/emil-skills`.
- [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) — Paul Bakaus, Apache-2.0.
  Design-quality **detector** (59 rules) for catching "AI slop" (generic gray borders,
  harsh shadows, purple gradients, bounce easing, cramped padding, small touch targets).
- [`leonxlnx/taste-skill`](https://github.com/leonxlnx/taste-skill) — Leonxlnx, MIT.
  High-end "agency" visual language (fonts, spacing, shadows, motion), both sharp and
  soft variants. Cloned to `/tmp/taste-skill`.

**Design read (per taste-skill §0.B):**
> "Reading this as: B2B internal developer-platform dashboard for technical users,
> Linear-style minimalist language, leaning toward Tailwind + custom-bezier motion,
> restrained but polished, both light + dark."

**Dials (per taste-skill §1):** `DESIGN_VARIANCE 6` · `MOTION_INTENSITY 5` · `VISUAL_DENSITY 4`.
This is a data-dense ops tool, not a landing page — variance + motion stay moderate.

---

## Non-negotiable rules (apply to every UI change)

1. **Never animate from `scale(0)`.** Enter from `scale(0.97) + opacity:0` →
   `scale(1) + opacity:1`. (emil-design-eng)
2. **Custom easing, never `ease-in`.** Enter = `--ease-out-expo` `cubic-bezier(0.16,1,0.3,1)`;
   on-screen movement = `--ease-spring` `cubic-bezier(0.34,1.3,0.2,1)`; drawers/modals =
   `--ease-drawer` `cubic-bezier(0.32,0.72,0,1)`. `ease-in` feels sluggish. (emil-design-eng)
3. **Buttons scale to `~0.97` on `:active`** (`.press-scale` utility). Press feedback is
   non-negotiable. (emil-design-eng)
4. **Animate only `transform` + `opacity`** (GPU-safe). Never `top/left/width/height`.
   Keep UI animations **<300ms** (modals up to 500ms). (emil-design-eng + taste-skill)
5. **No generic 1px gray borders + harsh shadows.** Use the `surface` layered-surface
   utility (soft ambient shadows, hairline `border-white/[0.08]` in dark). (impeccable)
6. **`backdrop-blur` only on fixed/sticky surfaces**, never scrolling content. (taste-skill)
7. **System z-index discipline** — no arbitrary `z-[9999]`. Use the shell's layer order. (taste-skill)
8. **Honor `prefers-reduced-motion`** (already handled in `globals.css`). (a11y)
9. **A simple hover/fade doesn't need the `motion` library** — plain CSS transitions are
   the right tool there. Reach for `motion` only for enter/exit + layout animation. (pick-ui-library)
10. **Both light + dark must stay tuned.** Dark is a deep desaturated ink (`neutral-950`
    with `white/[0.03-0.08]` hairlines); light is a warm/neutral canvas, not pure `#fff`.

## Libraries already wired (pick-ui-library picks)

- **Toasts → `sonner`** (`ToastHost` in `providers.tsx`, theme-aware).
- **Enter/exit + layout → `motion`** (`components/motion/reveal.tsx`: `Reveal`, `RevealList`).
- **Command palette → `cmdk`** (already present).
- **Theme switching → custom `ThemeScript` + `ThemeProvider`** (light/dark, class strategy,
  no-flash). Could migrate to `next-themes` later but the current one works.

## Components updated with the language (2026-08-03)

- `globals.css` — design tokens (easing vars), `surface`/`surface-hover`/`press-scale`
  utilities, `animate-*` keyframes, `prefers-reduced-motion` guard.
- `ui/button.tsx` — press-scale, custom easing, refined variants (soft outline/new dark).
- `ui/card.tsx` — now uses `surface`.
- `providers.tsx` — Sonner `Toaster` (theme-aware).
- `components/motion/reveal.tsx` — `Reveal` / `RevealList` (new).
- `components/engine/engine-view.tsx` — wrapped in `Reveal`; toasts on submit/cancel/approve/reject.
- `components/dashboard/live-dashboard.tsx` — `Reveal` wrapper + staggered stat cards (`surface-hover`).
- `app/tools/page.tsx` + `components/modules/federated-tool-tile.tsx` — `Reveal` grid + `surface-hover` tiles.
- `components/admin/admin-console.tsx` — `Reveal` wrapper + `surface-hover` summary cards.
- `components/modules/modules-view.tsx` — staggered `Reveal` grid + `surface-hover` cards.
- `components/brain/brain-view.tsx` — staggered `Reveal` stats + `surface` stat cards.
- `components/theme/theme-toggle.tsx` — animated sun/moon cross-fade-rotate on switch (GPU-safe).
- `shell/sidebar.tsx` + `shell/topbar.tsx` — translucent/backdrop-blur surfaces, accent glow, refined search.

## How to verify you didn't regress into slop

Run the `impeccable` detector against the web app (if the CLI is available):
```bash
# from the repo root (npx impeccable) — detects generic borders, purple gradients,
# bounce easing, cramped padding, small touch targets, skipped headings, etc.
npx impeccable detect apps/web/src
```
And re-run the web build + typecheck:
```bash
cd /c/Users/<user>/Claude/Code/constellation
./node_modules/.bin/turbo run typecheck build --force --concurrency=1 --filter=@constellation/web
```
Both light and dark themes must compile and render. Keep every rule above.

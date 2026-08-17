import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import daisyui from "daisyui";

/**
 * Constellation portal theme (daisyUI v4 — Tailwind v3.4 compatible).
 *
 * The portal reads as a "B2B internal developer-platform dashboard for
 * technical users" (see docs/DESIGN_SKILL.md): Linear-style minimalist
 * language, one considered accent, both light + dark tuned. daisyUI provides
 * the THEME TOKEN SYSTEM here: `constellation-light` / `constellation-dark`
 * drive every daisyUI color utility (`bg-primary`, `text-base-content`, …)
 * and the component classes used across the portal (`stats`, `badge`, …).
 * The shared UI primitives (Button/Input/Card) keep their own geometry and
 * reference these tokens, so a theme change re-skins the whole app without
 * touching layouts. The `dark` class on <html> (theme-script.tsx) stays the
 * single source of truth; `data-theme` is set from the same state.
 *
 * Palette notes (redesign-skill audit): one accent (indigo-violet, the
 * established brand), warm/neutral light canvas (NOT pure #fff), deep
 * desaturated ink dark (NOT pure #000), tinted shadows, consistent radius.
 */
export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // Neutral, brandable accent — swap per tenant theme later.
        accent: {
          DEFAULT: "#6d5efc",
          fg: "#ffffff",
        },
        // Muted secondary text, theme-aware: daisyUI's base-content at 60%
        // opacity (light: near-black gray, dark: near-white gray).
        "muted-foreground": "oklch(var(--bc) / 0.6)",
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    daisyui,
  ],
  daisyui: {
    themes: [
      {
        "constellation-light": {
          primary: "#6d5efc",
          "primary-content": "#ffffff",
          secondary: "#57534e",
          "secondary-content": "#ffffff",
          accent: "#6d5efc",
          "accent-content": "#ffffff",
          neutral: "#292524",
          "neutral-content": "#fafaf9",
          "base-100": "#fafaf9",
          "base-200": "#f5f5f4",
          "base-300": "#e7e5e4",
          "base-content": "#1c1917",
          info: "#0284c7",
          "info-content": "#f0f9ff",
          success: "#059669",
          "success-content": "#ecfdf5",
          warning: "#d97706",
          "warning-content": "#fffbeb",
          error: "#dc2626",
          "error-content": "#fef2f2",
          "--rounded-btn": "0.5rem",
          "--btn-focus-scale": "0.97",
          "--animation-btn": "0.15s",
        },
      },
      {
        "constellation-dark": {
          primary: "#8b7fff",
          "primary-content": "#0a0a0a",
          secondary: "#a8a29e",
          "secondary-content": "#0a0a0a",
          accent: "#8b7fff",
          "accent-content": "#0a0a0a",
          neutral: "#d6d3d1",
          "neutral-content": "#171717",
          "base-100": "#0a0a0a",
          "base-200": "#171717",
          "base-300": "#262626",
          "base-content": "#e7e5e4",
          info: "#38bdf8",
          "info-content": "#082f49",
          success: "#34d399",
          "success-content": "#022c22",
          warning: "#fbbf24",
          "warning-content": "#451a03",
          error: "#fb7185",
          "error-content": "#450a0a",
          "--rounded-btn": "0.5rem",
          "--btn-focus-scale": "0.97",
          "--animation-btn": "0.15s",
        },
      },
    ],
    darkTheme: "constellation-dark",
  },
} satisfies Config;

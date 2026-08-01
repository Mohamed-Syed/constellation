import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral, brandable accent — swap per tenant theme later.
        accent: {
          DEFAULT: "#6d5efc",
          fg: "#ffffff",
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;

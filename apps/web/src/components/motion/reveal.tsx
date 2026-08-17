"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";

/**
 * A lightweight enter/exit surface using the `motion` (Framer) library —
 * recommended by the `pick-ui-library` design skill for enter/exit + layout
 * animation. Configured to the portal's taste: strong ease-out, sub-300ms,
 * GPU-safe transform+opacity only (emil-design-eng). Honors prefers-reduced-motion
 * automatically via Motion's `useReducedMotion`.
 *
 * `once: true` so repeat visits don't re-trigger the initial fade for a
 * dashboard surface (motion is delighter, not noise — see DESIGN_SKILL.md).
 */
const container: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
  },
};

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={container}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/** Staggered list reveal for cards/tiles — children get progressive delay. */
export function RevealList({
  items,
  render,
  className,
}: {
  items: unknown[];
  render: (item: unknown, index: number) => React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {items.map((item, i) => (
        <Reveal key={i} delay={i * 0.04}>
          {render(item, i)}
        </Reveal>
      ))}
    </div>
  );
}

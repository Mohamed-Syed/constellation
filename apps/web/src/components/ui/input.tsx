import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors",
        "placeholder:text-neutral-400 dark:placeholder:text-neutral-500",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-neutral-800 dark:bg-neutral-900",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };

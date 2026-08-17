import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button — geometry stays fixed; colors come from the daisyUI theme tokens
 * (`constellation-light` / `constellation-dark`, see tailwind.config.ts), so
 * a theme change re-skins every button without touching layouts. Press
 * feedback = `.press-scale` (design-skill rule 3); tints on shadows follow
 * the redesign-skill "tinted shadows" audit.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium " +
    "press-scale outline-none transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-content shadow-[0_1px_2px_rgba(109,94,252,0.4)] hover:bg-primary/90 hover:shadow-[0_2px_6px_rgba(109,94,252,0.45)]",
        outline:
          "border border-base-300 bg-base-100/70 text-base-content/80 shadow-sm hover:bg-base-200 hover:text-base-content",
        secondary: "bg-base-300 text-base-content hover:bg-base-300/80",
        ghost: "text-base-content/70 hover:bg-base-200 hover:text-base-content",
        destructive: "bg-error text-error-content hover:bg-error/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 [&_svg]:size-4",
        sm: "h-8 rounded-md px-3 text-xs [&_svg]:size-3.5",
        lg: "h-10 rounded-lg px-6 [&_svg]:size-4",
        icon: "size-9 shrink-0 [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

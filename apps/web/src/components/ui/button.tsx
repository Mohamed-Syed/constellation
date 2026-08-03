import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium " +
    "press-scale outline-none transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg shadow-[0_1px_2px_rgba(109,94,252,0.4)] hover:bg-accent/90 hover:shadow-[0_2px_6px_rgba(109,94,252,0.45)]",
        outline:
          "border border-neutral-200 bg-white/60 text-neutral-700 shadow-sm backdrop-blur transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-200 dark:hover:bg-white/[0.06] dark:hover:text-white",
        secondary:
          "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:bg-white/[0.07] dark:text-neutral-100 dark:hover:bg-white/[0.12]",
        ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/[0.06] dark:hover:text-white",
        destructive: "bg-rose-600 text-white hover:bg-rose-500",
        link: "text-accent underline-offset-4 hover:underline",
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

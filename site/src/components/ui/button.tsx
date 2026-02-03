"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button variants using class-variance-authority.
 * Provides type-safe variant definitions with Tailwind classes.
 */
const buttonVariants = cva(
  // Base styles applied to all buttons
  [
    "inline-flex items-center justify-center gap-2",
    "whitespace-nowrap rounded-md text-sm font-medium",
    "transition-all duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        /** Primary action button - most prominent */
        default: [
          "bg-primary text-primary-foreground",
          "shadow-sm shadow-primary/20",
          "hover:bg-primary/90 hover:shadow-md hover:shadow-primary/30 hover:-translate-y-0.5",
          "active:translate-y-0",
        ],
        /** Destructive/danger actions */
        destructive: [
          "bg-destructive text-destructive-foreground",
          "shadow-sm",
          "hover:bg-destructive/90",
        ],
        /** Bordered button for secondary actions */
        outline: [
          "border border-border bg-transparent",
          "hover:bg-muted hover:border-muted-foreground/30",
        ],
        /** Filled secondary style */
        secondary: [
          "bg-secondary text-secondary-foreground",
          "shadow-sm",
          "hover:bg-secondary/80",
        ],
        /** Minimal style for tertiary actions */
        ghost: "hover:bg-muted hover:text-foreground",
        /** Link-style button */
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8 text-base",
        xl: "h-12 rounded-lg px-10 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * If true, the button will render as its child element (for custom Link components).
   * Uses Radix Slot for composition.
   */
  asChild?: boolean;
}

/**
 * Button component with multiple variants and sizes.
 *
 * @example
 * // Primary button
 * <Button>Click me</Button>
 *
 * @example
 * // Outline variant, large size
 * <Button variant="outline" size="lg">Secondary</Button>
 *
 * @example
 * // As a link (using asChild)
 * <Button asChild>
 *   <Link href="/docs">Documentation</Link>
 * </Button>
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

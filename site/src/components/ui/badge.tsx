"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge variants using class-variance-authority.
 */
const badgeVariants = cva(
  // Base styles
  [
    "inline-flex items-center",
    "rounded-full px-2.5 py-0.5",
    "text-xs font-medium",
    "transition-colors",
  ],
  {
    variants: {
      variant: {
        /** Default filled badge */
        default: "bg-primary text-primary-foreground",
        /** Secondary/muted badge */
        secondary: "bg-secondary text-secondary-foreground",
        /** Accent color badge */
        accent: "bg-accent text-accent-foreground",
        /** Bordered badge - subtle appearance */
        outline: "border border-border text-foreground bg-transparent",
        /** Success indicator */
        success: "bg-green-500/10 text-green-400 border border-green-500/20",
        /** Warning indicator */
        warning: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
        /** Error/destructive indicator */
        destructive: "bg-destructive/10 text-destructive border border-destructive/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * Badge component for labels, tags, and status indicators.
 *
 * @example
 * // Default badge
 * <Badge>New</Badge>
 *
 * @example
 * // Outline variant
 * <Badge variant="outline">Open Source</Badge>
 *
 * @example
 * // Success status
 * <Badge variant="success">Active</Badge>
 */
function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

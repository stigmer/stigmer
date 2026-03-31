"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge variants using class-variance-authority.
 */
const badgeVariants = cva(
  [
    "inline-flex items-center",
    "rounded-full px-2.5 py-0.5",
    "text-xs font-medium font-mono uppercase tracking-wider",
    "transition-colors",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-muted-foreground bg-transparent",
        muted: "border border-border text-subtle bg-transparent",
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

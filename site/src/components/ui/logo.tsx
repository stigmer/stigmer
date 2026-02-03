import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";

/**
 * Logo size variants using class-variance-authority.
 */
const logoVariants = cva("inline-flex items-center gap-2", {
  variants: {
    size: {
      sm: "gap-1.5",
      md: "gap-2",
      lg: "gap-3",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const logoMarkVariants = cva(
  [
    "inline-flex items-center justify-center",
    "rounded-lg",
    "bg-gradient-to-br from-primary to-accent",
    "shadow-lg shadow-primary/20",
    "font-bold text-white",
    "select-none",
  ],
  {
    variants: {
      size: {
        sm: "w-7 h-7 text-sm rounded-md",
        md: "w-9 h-9 text-lg",
        lg: "w-12 h-12 text-2xl rounded-xl",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

const logoTextVariants = cva("font-bold tracking-tight text-foreground", {
  variants: {
    size: {
      sm: "text-lg",
      md: "text-xl",
      lg: "text-2xl",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export interface LogoProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">,
    VariantProps<typeof logoVariants> {
  /**
   * Whether to show the wordmark text alongside the logo mark.
   * @default true
   */
  showText?: boolean;
  /**
   * Whether to wrap the logo in a Link to the homepage.
   * @default true
   */
  asLink?: boolean;
}

/**
 * Stigmer brand logo with mark and optional wordmark.
 *
 * @example
 * // Full logo with text
 * <Logo />
 *
 * @example
 * // Logo mark only (for mobile/compact)
 * <Logo showText={false} />
 *
 * @example
 * // Large logo for footer
 * <Logo size="lg" />
 *
 * @example
 * // As a static element (no link)
 * <Logo asLink={false} />
 */
const Logo = React.forwardRef<HTMLAnchorElement, LogoProps>(
  ({ className, size, showText = true, asLink = true, ...props }, ref) => {
    const content = (
      <>
        {/* Logo mark */}
        <span className={cn(logoMarkVariants({ size }))} aria-hidden="true">
          S
        </span>
        {/* Wordmark */}
        {showText && (
          <span className={cn(logoTextVariants({ size }))}>
            {SITE_CONFIG.name}
          </span>
        )}
      </>
    );

    if (asLink) {
      return (
        <Link
          ref={ref}
          href="/"
          className={cn(
            logoVariants({ size }),
            "transition-opacity hover:opacity-80",
            className
          )}
          aria-label={`${SITE_CONFIG.name} - Go to homepage`}
          {...props}
        >
          {content}
        </Link>
      );
    }

    return (
      <div
        className={cn(logoVariants({ size }), className)}
        role="img"
        aria-label={SITE_CONFIG.name}
      >
        {content}
      </div>
    );
  }
);
Logo.displayName = "Logo";

export { Logo, logoVariants, logoMarkVariants, logoTextVariants };

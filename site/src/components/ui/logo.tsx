import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";

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

const logoMarkSizeMap = {
  sm: "w-7 h-7",
  md: "w-9 h-9",
  lg: "w-12 h-12",
} as const;

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
  showText?: boolean;
  asLink?: boolean;
}

const Logo = React.forwardRef<HTMLAnchorElement, LogoProps>(
  ({ className, size, showText = true, asLink = true, ...props }, ref) => {
    const resolvedSize = size ?? "md";
    const content = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Icon-bw.svg"
          alt=""
          aria-hidden="true"
          className={cn(logoMarkSizeMap[resolvedSize])}
        />
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

export { Logo, logoVariants, logoTextVariants };

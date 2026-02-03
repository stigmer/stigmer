import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export type StigmerLogoSize = "sm" | "md" | "lg";

export type StigmerLogoProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Logo size variant */
  size?: StigmerLogoSize;
  /** Whether to show the logo with container background/shadow */
  withContainer?: boolean;
};

const sizeMap: Record<StigmerLogoSize, number> = {
  sm: 40,
  md: 64,
  lg: 96,
};

/**
 * Official Stigmer logo component with size variants.
 *
 * Features:
 * - Three size variants: sm (40px), md (64px), lg (96px)
 * - Optional container with gradient background and shadow
 * - Responsive sizing
 * - Optimized Next.js Image component
 *
 * @example
 * <StigmerLogo size="lg" withContainer />
 */
function StigmerLogo({
  size = "md",
  withContainer = false,
  className,
  ...props
}: StigmerLogoProps) {
  const dimensions = sizeMap[size];

  const logo = (
    <Image
      src="/logo.svg"
      alt="Stigmer"
      width={dimensions}
      height={dimensions}
      className={cn("w-full h-full", !withContainer && className)}
      priority
    />
  );

  if (!withContainer) {
    return (
      <div
        className={cn("inline-flex", className)}
        style={{ width: dimensions, height: dimensions }}
        {...props}
      >
        {logo}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center",
        "rounded-2xl",
        "bg-gradient-to-br from-primary to-accent",
        "shadow-2xl shadow-primary/30",
        className
      )}
      style={{ width: dimensions, height: dimensions }}
      {...props}
    >
      {logo}
    </div>
  );
}

export { StigmerLogo };

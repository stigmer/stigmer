"use client";

import { cn } from "@stigmer/design-tokens";

/** Props for {@link ResourceAvatar}. */
export interface ResourceAvatarProps {
  /** Display name used for the initial fallback. */
  readonly name: string;
  /** The resource's slug; its first letter is the initial when `name` is empty. */
  readonly slug: string;
  /** Icon URL from the resource's spec. Empty string means no icon. */
  readonly iconUrl?: string;
  /**
   * When `true`, renders nothing — no image, no initial avatar.
   * Used for resource types like skills that don't support icons.
   */
  readonly hidden?: boolean;
  /** Size variant. @default "md" */
  readonly size?: "sm" | "md";
  /** Additional CSS classes. */
  readonly className?: string;
}

const SIZE_CLASSES = {
  sm: "stg:size-6 stg:text-2xs",
  md: "stg:size-8 stg:text-xs",
} as const;

/**
 * Compact resource avatar for cards, rows, and detail headers.
 *
 * Renders one of three states:
 * 1. **Image** — when `iconUrl` is a non-empty string
 * 2. **Initial** — the first letter of `name` on the theme's avatar
 *    colour (`--stgm-avatar`), as a grantee's initial is drawn, so every
 *    preset themes it and the theme contract keeps the letter readable
 * 3. **Hidden** — nothing (for resource types that don't support icons)
 */
export function ResourceAvatar({
  name,
  slug,
  iconUrl,
  hidden,
  size = "md",
  className,
}: ResourceAvatarProps) {
  if (hidden) return null;

  const sizeClass = SIZE_CLASSES[size];

  if (iconUrl) {
    return (
      <span
        className={cn(
          "stg:inline-flex stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted",
          sizeClass,
          className,
        )}
      >
        <img
          src={iconUrl}
          alt=""
          className="stg:size-4/5 stg:object-contain"
        />
      </span>
    );
  }

  const initial = (name || slug).charAt(0).toUpperCase();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "stg:inline-flex stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-avatar stg:font-medium stg:text-muted-foreground",
        sizeClass,
        className,
      )}
    >
      {initial}
    </span>
  );
}

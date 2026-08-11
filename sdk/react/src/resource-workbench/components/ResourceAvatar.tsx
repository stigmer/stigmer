"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link ResourceAvatar}. */
export interface ResourceAvatarProps {
  /** Display name used for the initial fallback. */
  readonly name: string;
  /** Slug used to derive a deterministic background color. */
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

const AVATAR_COLORS = [
  "stg:bg-[#6366f1]",
  "stg:bg-[#8b5cf6]",
  "stg:bg-[#a855f7]",
  "stg:bg-[#d946ef]",
  "stg:bg-[#ec4899]",
  "stg:bg-[#f43f5e]",
  "stg:bg-[#ef4444]",
  "stg:bg-[#f97316]",
  "stg:bg-[#eab308]",
  "stg:bg-[#22c55e]",
  "stg:bg-[#14b8a6]",
  "stg:bg-[#06b6d4]",
  "stg:bg-[#3b82f6]",
  "stg:bg-[#2563eb]",
] as const;

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const SIZE_CLASSES = {
  sm: "stg:size-6 stg:text-[10px]",
  md: "stg:size-8 stg:text-xs",
} as const;

/**
 * Compact resource avatar for cards, rows, and detail headers.
 *
 * Renders one of three states:
 * 1. **Image** — when `iconUrl` is a non-empty string
 * 2. **Initial** — colored circle with the first letter of `name`,
 *    deterministic color derived from `slug`
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
  const colorClass = AVATAR_COLORS[hashSlug(slug) % AVATAR_COLORS.length];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "stg:inline-flex stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:font-medium stg:text-white",
        sizeClass,
        colorClass,
        className,
      )}
    >
      {initial}
    </span>
  );
}

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
  "bg-[#6366f1]",
  "bg-[#8b5cf6]",
  "bg-[#a855f7]",
  "bg-[#d946ef]",
  "bg-[#ec4899]",
  "bg-[#f43f5e]",
  "bg-[#ef4444]",
  "bg-[#f97316]",
  "bg-[#eab308]",
  "bg-[#22c55e]",
  "bg-[#14b8a6]",
  "bg-[#06b6d4]",
  "bg-[#3b82f6]",
  "bg-[#2563eb]",
] as const;

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const SIZE_CLASSES = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
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
          "inline-flex shrink-0 items-center justify-center rounded-full bg-muted",
          sizeClass,
          className,
        )}
      >
        <img
          src={iconUrl}
          alt=""
          className="size-4/5 object-contain"
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
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        sizeClass,
        colorClass,
        className,
      )}
    >
      {initial}
    </span>
  );
}

"use client";

/**
 * The round mark beside a grantee's name, one component so a team reads
 * the same in the share picker, the access list and a team's member list:
 * a person is their initial, a team is the group glyph. The glyph is the
 * only thing that tells the two apart at a glance, so it never falls back
 * to an initial for a team.
 *
 * The circle is `--stgm-avatar`, not `--stgm-muted`: the avatar sits on
 * dialogs, menus and cards, and in dark mode a muted fill equals the
 * popover surface and the circle vanishes. The theme contract holds the
 * avatar apart from all three surfaces.
 */
import { UsersRound } from "lucide-react";
import type { GranteeKind } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";

/** Props for {@link GranteeAvatar}. */
export interface GranteeAvatarProps {
  readonly kind: GranteeKind;
  /** The grantee's display name; a person's avatar shows its first letter. */
  readonly name: string;
  readonly className?: string;
}

export function GranteeAvatar({ kind, name, className }: GranteeAvatarProps) {
  return (
    <div
      className={cn(
        "stg:flex stg:h-6 stg:w-6 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-avatar stg:text-[0.6rem] stg:font-medium stg:text-muted-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {kind === "team" ? <UsersRound className="stg:h-3.5 stg:w-3.5" /> : (name[0] ?? "?").toUpperCase()}
    </div>
  );
}

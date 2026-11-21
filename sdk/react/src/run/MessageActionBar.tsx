"use client";

// A host's actions on one message, drawn by the kit in the row they join:
// an agent message's quiet row after Copy and the scores, a person's
// floating cluster after Copy and Edit. The first two actions with an icon
// are quiet icon buttons, named by their label (its tooltip and accessible
// name); every other action sits, in order, in one "More actions" menu,
// reached by Tab and opened by Enter, its items walked with the arrows and
// closed with Escape back to its trigger. No action takes a key.

import { cn } from "@stigmer/design-tokens";
import { ActionMenu } from "../action-menu/ActionMenu.js";
import { IconButton } from "../button/IconButton.js";
import type { MessageAction } from "./message-actions.js";

/** How many actions with an icon draw as buttons before the rest go to the menu. */
const ICON_SLOTS = 2;

/** Props for {@link MessageActionBar}. */
interface MessageActionBarProps {
  readonly actions: readonly MessageAction[];
  /** The row they join: the agent's quiet row, or a person's bubble cluster. */
  readonly variant: "quiet" | "bubble";
  /** The classes each control takes to match its row's other controls. */
  readonly controlClassName: string;
}

/**
 * @internal A host's message actions (module header).
 */
export function MessageActionBar({ actions, variant, controlClassName }: MessageActionBarProps) {
  if (actions.length === 0) return null;
  const shown: MessageAction[] = [];
  const rest: MessageAction[] = [];
  for (const action of actions) {
    if (action.icon != null && shown.length < ICON_SLOTS) shown.push(action);
    else rest.push(action);
  }
  return (
    <>
      {shown.map((action) => (
        <IconButton
          key={action.id}
          variant={variant === "bubble" ? "outline" : "ghost"}
          size="xs"
          label={action.label}
          icon={action.icon}
          disabled={action.disabled}
          onClick={action.onAction}
          className={cn(controlClassName, action.variant === "destructive" && DESTRUCTIVE_CLASSES)}
        />
      ))}
      {rest.length > 0 && (
        <ActionMenu>
          <ActionMenu.Trigger aria-label="More actions" size="xs" className={cn(controlClassName, variant === "bubble" && BUBBLE_TRIGGER_CLASSES)}>
            <MoreIcon />
          </ActionMenu.Trigger>
          <ActionMenu.Content align="start">
            {rest.map((action) => (
              <ActionMenu.Item key={action.id} icon={action.icon} variant={action.variant} disabled={action.disabled} onSelect={action.onAction}>
                {action.label}
              </ActionMenu.Item>
            ))}
          </ActionMenu.Content>
        </ActionMenu>
      )}
    </>
  );
}

/** A destructive action's button in the failed tone, at rest and on hover. */
const DESTRUCTIVE_CLASSES = "stg:text-status-failed stg:hover:text-status-failed";

/** The menu's trigger in a person's cluster: the cluster's round outline, as its Copy and Edit draw. */
const BUBBLE_TRIGGER_CLASSES = "stg:border stg:border-border stg:bg-card";

/** Three dots in a row, the kit's "more" glyph at the row's 13px. */
function MoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="13" cy="8" r="1.25" />
    </svg>
  );
}

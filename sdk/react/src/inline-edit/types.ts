import type { ReactNode } from "react";

/** Shared props for all inline edit components. */
export interface InlineEditBaseProps {
  /** Whether editing is disabled (component renders as read-only). */
  readonly disabled?: boolean;
  /** `true` while a save operation is in flight. */
  readonly isSaving?: boolean;
  /** Error from the last failed save. Shown inline below the field. */
  readonly error?: string | null;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/** Entry in an inline key-value editor. */
export interface KeyValueRow {
  readonly key: string;
  readonly value: string;
  /** When `true`, renders a "secret" badge. */
  readonly isSecret?: boolean;
  /** Optional description shown as helper text. */
  readonly description?: string;
  /** When `true`, this row is optional. */
  readonly optional?: boolean;
}

/** Entry in an inline resource reference list (MCP servers, skills, etc.). */
export interface ResourceRefRow {
  readonly org: string;
  readonly slug: string;
  /** Display label (defaults to slug when omitted). */
  readonly label?: string;
}

/** Single option for InlineEditSelect. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

/** Save result returned to the inline component after a field save. */
export interface InlineFieldSaveResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

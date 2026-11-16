// The classes every field in the kit is drawn with, in one place, at the
// button's sizes: 32px at 14/20 for a form, 28px at 12/16 for an inline row,
// the button's 6px corner and its 2px focus ring, the input border on the
// input fill. A field and the button beside it line up. An error draws the
// border in the failed status hue; disabled is half opacity, as a button is.
// A field fills the width it is given, as the kit's fields did; one that
// sizes to its content (a time, a short number) says so (`w-auto`, `w-24`).
//
// `bare` is a field inside another control's own frame (a picker's search
// box, a chip editor): it keeps the type, the placeholder and the focus
// handling, and draws no frame of its own.

import { cn } from "@stigmer/design-tokens";

/** A field's size, the button's: `sm` 32px at 14/20, `xs` 28px at 12/16. */
export type FieldSize = "sm" | "xs";

/** How a field draws its frame: `field` its own border and fill, `bare` none (inside another control's frame). */
export type FieldAppearance = "field" | "bare";

/** Each size's height, padding and type, one-line controls. */
export const FIELD_SIZE_CLASSES: Record<FieldSize, string> = {
  sm: "stg:h-8 stg:px-2.5 stg:text-sm",
  xs: "stg:h-7 stg:px-2 stg:text-xs",
};

/** Each size's padding and type for a multi-line box, which grows with its rows. */
export const AREA_SIZE_CLASSES: Record<FieldSize, string> = {
  sm: "stg:px-2.5 stg:py-1.5 stg:text-sm",
  xs: "stg:px-2 stg:py-1 stg:text-xs",
};

const FRAME = cn(
  "stg:rounded-lg stg:border stg:bg-input-bg stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:transition-colors stg:motion-reduce:transition-none",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
  "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
);

const BARE = cn(
  "stg:border-0 stg:bg-transparent stg:p-0 stg:text-foreground stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
);

/** The classes of a one-line field: the frame, the size, and the error's border. */
export function fieldControlClasses({
  size = "sm",
  invalid = false,
  appearance = "field",
}: {
  readonly size?: FieldSize;
  readonly invalid?: boolean;
  readonly appearance?: FieldAppearance;
} = {}): string {
  if (appearance === "bare")
    return cn(
      "stg:min-w-0",
      BARE,
      size === "xs" ? "stg:text-xs" : "stg:text-sm",
    );
  return cn(
    "stg:w-full stg:min-w-0",
    FRAME,
    FIELD_SIZE_CLASSES[size],
    invalid ? "stg:border-status-failed" : "stg:border-input",
  );
}

/** The classes of a multi-line field: the frame, the size's padding and type, and the error's border. */
export function areaControlClasses({
  size = "sm",
  invalid = false,
  appearance = "field",
}: {
  readonly size?: FieldSize;
  readonly invalid?: boolean;
  readonly appearance?: FieldAppearance;
} = {}): string {
  if (appearance === "bare")
    return cn(
      "stg:min-w-0 stg:resize-none",
      BARE,
      size === "xs" ? "stg:text-xs" : "stg:text-sm",
    );
  return cn(
    "stg:block stg:w-full stg:min-w-0",
    FRAME,
    AREA_SIZE_CLASSES[size],
    invalid ? "stg:border-status-failed" : "stg:border-input",
  );
}

/** A field's label: 14/20 medium in the foreground. Forms that draw a label of their own use it too. */
export const FIELD_LABEL_CLASSES =
  "stg:block stg:text-sm stg:font-medium stg:text-foreground";

/** A field's hint: 12/16 muted. */
export const FIELD_HINT_CLASSES =
  "stg:m-0 stg:text-xs stg:text-muted-foreground";

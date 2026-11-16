"use client";

// The kit's form controls, each the native element styled at the button's
// sizes (`fieldClasses.ts`): the native element keeps its keyboard, autofill
// and screen-reader behaviour, and a control inside a `Field` takes its id,
// its description and its error from there. Each accepts every prop its
// element does, and a ref, so a form keeps its own handlers.

import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@stigmer/design-tokens";
import { Check, ChevronDown } from "lucide-react";
import { areaControlClasses, fieldControlClasses, type FieldAppearance, type FieldSize } from "./fieldClasses.js";
import { useFieldWiring, wireControl } from "./Field.js";

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

/** Props for {@link TextInput}. */
export interface TextInputProps extends NativeInputProps {
  /** `sm` (32px at 14/20, the default) or `xs` (28px at 12/16, inline rows). */
  readonly size?: FieldSize;
  /** Draws the field in error; a `Field` with an `error` sets it too. */
  readonly invalid?: boolean;
  /** `bare` draws no frame: the field sits inside another control's frame. */
  readonly appearance?: FieldAppearance;
  readonly ref?: Ref<HTMLInputElement>;
}

/** A one-line field: text, a number, an address, a password, a date or a time. */
export function TextInput({ size, invalid, appearance, className, ref, type = "text", ...rest }: TextInputProps) {
  const wired = wireControl(useFieldWiring(), { id: rest.id, "aria-describedby": rest["aria-describedby"], "aria-invalid": rest["aria-invalid"] as boolean | undefined, invalid });
  return (
    <input
      {...rest}
      ref={ref}
      type={type}
      id={wired.id}
      aria-describedby={wired["aria-describedby"]}
      aria-invalid={wired["aria-invalid"]}
      className={cn(fieldControlClasses({ size, invalid: wired.invalid, appearance }), className)}
    />
  );
}

/** Props for {@link TextArea}. */
export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly size?: FieldSize;
  readonly invalid?: boolean;
  readonly appearance?: FieldAppearance;
  readonly ref?: Ref<HTMLTextAreaElement>;
}

/** A multi-line field. It keeps its rows and resizes vertically unless the form says otherwise. */
export function TextArea({ size, invalid, appearance, className, ref, ...rest }: TextAreaProps) {
  const wired = wireControl(useFieldWiring(), { id: rest.id, "aria-describedby": rest["aria-describedby"], "aria-invalid": rest["aria-invalid"] as boolean | undefined, invalid });
  return (
    <textarea
      {...rest}
      ref={ref}
      id={wired.id}
      aria-describedby={wired["aria-describedby"]}
      aria-invalid={wired["aria-invalid"]}
      className={cn(areaControlClasses({ size, invalid: wired.invalid, appearance }), className)}
    />
  );
}

type NativeSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">;

/** Props for {@link Select}. */
export interface SelectProps extends NativeSelectProps {
  readonly size?: FieldSize;
  readonly invalid?: boolean;
  readonly ref?: Ref<HTMLSelectElement>;
  /** Classes for the wrapper that holds the select and its chevron (its width, its place in a row). */
  readonly wrapperClassName?: string;
  readonly children: ReactNode;
}

/** A choice from a list: the native select, drawn as a field with its chevron. */
/** A layout class (its width, its share of a row, its place in a grid) belongs on the select's wrapper, which is what sits in the row. */
const WRAPPER_LAYOUT = /^(stg:)?((sm|md|lg):)?(w-|min-w-|max-w-|flex-|grow|shrink|basis-|self-|col-span-|order-)/;

export function Select({ size = "sm", invalid, className, wrapperClassName, ref, children, ...rest }: SelectProps) {
  const own = (className ?? "").split(/\s+/).filter(Boolean);
  const layout = own.filter((c) => WRAPPER_LAYOUT.test(c)).join(" ");
  const look = own.filter((c) => !WRAPPER_LAYOUT.test(c)).join(" ");
  const wired = wireControl(useFieldWiring(), { id: rest.id, "aria-describedby": rest["aria-describedby"], "aria-invalid": rest["aria-invalid"] as boolean | undefined, invalid });
  return (
    <span className={cn("stg:relative stg:flex stg:min-w-0 stg:items-center", layout, wrapperClassName)}>
      <select
        {...rest}
        ref={ref}
        id={wired.id}
        aria-describedby={wired["aria-describedby"]}
        aria-invalid={wired["aria-invalid"]}
        className={cn(fieldControlClasses({ size, invalid: wired.invalid }), "stg:cursor-pointer stg:appearance-none", size === "xs" ? "stg:pr-6" : "stg:pr-8", look)}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className={cn("stg:pointer-events-none stg:absolute stg:text-muted-foreground", size === "xs" ? "stg:right-1.5 stg:size-3.5" : "stg:right-2.5 stg:size-4")}
      />
    </span>
  );
}

/** Props for {@link Checkbox} and {@link Radio}. */
export interface CheckProps extends Omit<NativeInputProps, "type"> {
  readonly ref?: Ref<HTMLInputElement>;
  /**
   * Keeps the native control for the keyboard and a screen reader and draws
   * nothing: a choice card around it shows what is chosen.
   */
  readonly visuallyHidden?: boolean;
}

const CHECK_BOX = cn(
  "stg:peer stg:size-4 stg:shrink-0 stg:cursor-pointer stg:appearance-none stg:border stg:border-border-strong stg:bg-input-bg",
  "stg:checked:border-primary stg:checked:bg-primary",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-2",
  "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
);

/** A checkbox: the native element, 16px with a 4px corner (`rounded-md`), filled when checked. Its label sits beside it. */
export function Checkbox({ className, ref, visuallyHidden, ...rest }: CheckProps) {
  const wired = wireControl(useFieldWiring(), { id: rest.id, "aria-describedby": rest["aria-describedby"] });
  if (visuallyHidden) return <input {...rest} ref={ref} type="checkbox" id={wired.id} aria-describedby={wired["aria-describedby"]} className={cn("stg:sr-only", className)} />;
  return (
    <span className="stg:relative stg:inline-flex stg:size-4 stg:shrink-0">
      <input
        {...rest}
        ref={ref}
        type="checkbox"
        id={wired.id}
        aria-describedby={wired["aria-describedby"]}
        className={cn(CHECK_BOX, "stg:rounded-md", className)}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="stg:pointer-events-none stg:absolute stg:inset-0.5 stg:size-3 stg:text-primary-foreground stg:opacity-0 stg:peer-checked:opacity-100"
      />
    </span>
  );
}

/** A radio button: the native element, 16px round, its dot drawn when chosen. Its label sits beside it. */
export function Radio({ className, ref, visuallyHidden, ...rest }: CheckProps) {
  if (visuallyHidden) return <input {...rest} ref={ref} type="radio" className={cn("stg:sr-only", className)} />;
  return (
    <span className="stg:relative stg:inline-flex stg:size-4 stg:shrink-0">
      <input
        {...rest}
        ref={ref}
        type="radio"
        className={cn(CHECK_BOX, "stg:rounded-full stg:checked:bg-input-bg", className)}
      />
      <span
        aria-hidden="true"
        className="stg:pointer-events-none stg:absolute stg:inset-1 stg:rounded-full stg:bg-primary stg:opacity-0 stg:peer-checked:opacity-100"
      />
    </span>
  );
}

/** Props for {@link HiddenFileInput}. */
export interface HiddenFileInputProps extends Omit<NativeInputProps, "type" | "hidden" | "className"> {
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * The file chooser behind a button or a drop zone: never seen, opened by the
 * button that names it (`ref.current.click()`), so the person sees the kit's
 * button and the system's file picker, not the browser's unstyled field.
 */
export function HiddenFileInput({ ref, ...rest }: HiddenFileInputProps) {
  return <input {...rest} ref={ref} type="file" tabIndex={-1} aria-hidden="true" className="stg:hidden" />;
}

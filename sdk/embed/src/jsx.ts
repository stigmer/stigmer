/**
 * Opt-in JSX typing for `<stigmer-agent>` — import once and the element
 * typechecks in any React 19 TSX file:
 *
 * ```ts
 * import "@stigmer/embed/define"; // registers the element (runtime)
 * import "@stigmer/embed/jsx";    // teaches TypeScript about it (types only)
 * ```
 *
 * This module is deliberately type-only: it emits an inert `dist/jsx.js` (so
 * the subpath resolves at runtime) and carries no runtime dependency on React
 * — the package's framework-free charter is untouched. It augments the JSX
 * namespace exported by the `react` module itself, which `react/jsx-runtime`
 * re-exports, so one augmentation covers the automatic runtime, the classic
 * runtime, and direct `React.JSX` references. React 19's types define no
 * global `JSX` namespace, so a `declare global` augmentation would silently
 * do nothing — do not "simplify" this back to one.
 *
 * Importing this subpath from a project without `@types/react` fails with
 * TypeScript's "Invalid module name in augmentation" error — acceptable and
 * self-explanatory for an explicitly-React entry point.
 */

import type { ClassAttributes, HTMLAttributes } from "react";
// Type-only: erased at compile time, so the element implementation is never
// pulled into a consumer's bundle by this subpath.
import type { StigmerAgentElement } from "./element.js";

/**
 * JSX attributes for `<stigmer-agent>` — one prop per observed attribute
 * (see `OBSERVED_ATTRIBUTES` in `element.ts`; keep the two in sync).
 *
 * React sets these as HTML attributes (the element defines no matching
 * properties), and the element rebuilds its iframe — destroying any
 * in-progress conversation — whenever ANY of them changes. Keep every value
 * referentially stable for the life of the element; resolve dynamic values
 * (like a theme) once, before mounting.
 *
 * Every attribute is optional, including the two the element requires at
 * runtime (`org`, `agent`, which it enforces with a console error). This is
 * NOT laziness: libraries like react-markdown build mapped types over
 * `JSX.IntrinsicElements`, and an intrinsic with required props breaks their
 * assignability for every project that imports this augmentation. All
 * standard intrinsics are typed all-optional for the same reason.
 */
// ClassAttributes supplies `ref`/`key` (mirroring React's DetailedHTMLProps);
// HTMLAttributes supplies the standard global attributes minus `children`.
interface StigmerAgentAttributes
  extends ClassAttributes<StigmerAgentElement>,
    Omit<HTMLAttributes<StigmerAgentElement>, "children"> {
  /**
   * Organization slug — first path segment of the hosted chat URL.
   * Required at runtime (see above for why the type cannot enforce it).
   */
  org?: string;
  /**
   * Agent share slug — second path segment of the hosted chat URL.
   * Required at runtime (see above for why the type cannot enforce it).
   */
  agent?: string;
  /** Link token for a locked share; forwarded as the `?k=` parameter. */
  token?: string;
  /**
   * Color mode, resolved once at mount. `auto` follows the OS
   * `prefers-color-scheme`; omit it to let the hosted page pick its default.
   */
  theme?: "light" | "dark" | "auto";
  /** Host element CSS width; bare digits are treated as px. Default 400px. */
  width?: string | number;
  /** Host element CSS height; bare digits are treated as px. Default 600px. */
  height?: string | number;
  /**
   * Origin of the Stigmer app hosting the chat page (e.g.
   * `https://app.stigmer.ai`). Required for bundler consumers — there is no
   * loader `<script src>` to derive it from.
   */
  "app-origin"?: string;
  /**
   * `children` is omitted from the inherited attributes: the element owns its
   * subtree (it injects the chat iframe), so React-rendered children would
   * conflict with it. Listen for the `stigmer:ready` / `stigmer:refused`
   * CustomEvents via a ref — colon-named events are not expressible as JSX
   * props.
   */
  children?: never;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "stigmer-agent": StigmerAgentAttributes;
    }
  }
}

// Augmentations only apply from modules; this makes the file one.
export {};

/**
 * Domain model for the React SDK docs generator.
 *
 * These types represent the generator's internal view of the SDK —
 * parsed from TypeDoc JSON, independent of the output format.
 */

// ---------------------------------------------------------------------------
// Top-level grouping
// ---------------------------------------------------------------------------

export interface Domain {
  slug: string;
  title: string;
  description: string;
  hooks: Hook[];
  components: Component[];
  /** Standalone types not associated with a specific hook or component. */
  types: TypeDef[];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export interface Hook {
  name: string;
  description: CommentPart[];
  parameters: Param[];
  returnType: TypeRef;
  /** Resolved return-type interface (set during linking). */
  returnInterface: TypeDef | null;
  examples: string[];
  sourceUrl: string;
}

export interface Component {
  name: string;
  description: CommentPart[];
  /** Whether the component function declares any parameters. */
  hasProps: boolean;
  /** Resolved props interface (set during linking). */
  propsInterface: TypeDef | null;
  examples: string[];
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface TypeDef {
  name: string;
  description: CommentPart[];
  category: "props" | "return" | "other";
  fields: Field[];
  /** Name of the hook or component this type is associated with (null = standalone). */
  associatedExport: string | null;
  /** Function signature, present when this TypeDef represents an exported utility function. */
  signature: string | null;
  examples: string[];
}

export interface Field {
  name: string;
  typeString: string;
  description: string;
  required: boolean;
  /** URL or anchor for the type's documentation (TypeTable typeDescriptionLink). */
  typeLink: string | null;
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface Param {
  name: string;
  typeString: string;
  description: string;
  required: boolean;
}

export interface TypeRef {
  name: string;
  typeString: string;
}

export type CommentPart =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; target: string | null };

/**
 * TypeDoc JSON v2 schema types.
 *
 * Covers the reflection structures observed in @stigmer/react's
 * dist/api.json output (TypeDoc 0.28.x, schemaVersion "2.0").
 */

export const ReflectionKind = {
  Project: 1,
  Module: 2,
  Variable: 32,
  Function: 64,
  Interface: 256,
  Property: 1024,
  TypeAlias: 2097152,
  CallSignature: 4096,
  Parameter: 32768,
} as const;

// ---------------------------------------------------------------------------
// Core structures
// ---------------------------------------------------------------------------

export interface TypeDocProject {
  schemaVersion: string;
  id: number;
  name: string;
  variant: "project";
  kind: number;
  children: Reflection[];
  symbolIdMap: Record<string, SymbolId>;
  packageName: string;
}

export interface Reflection {
  id: number;
  name: string;
  variant: string;
  kind: number;
  flags: ReflectionFlags;
  children?: Reflection[];
  groups?: ReflectionGroup[];
  signatures?: Reflection[];
  parameters?: Reflection[];
  sources?: Source[];
  comment?: Comment;
  type?: TypeDocType;
  defaultValue?: string;
}

export interface ReflectionFlags {
  isOptional?: boolean;
  isReadonly?: boolean;
  isPrivate?: boolean;
  isProtected?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  isConst?: boolean;
}

export interface ReflectionGroup {
  title: string;
  children: number[];
}

export interface Source {
  fileName: string;
  line: number;
  character: number;
  url?: string;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface Comment {
  summary?: CommentDisplayPart[];
  blockTags?: BlockTag[];
}

export interface CommentDisplayPart {
  kind: "text" | "code" | "inline-tag";
  text: string;
  tag?: string;
  target?: number | ExternalTarget;
}

export interface BlockTag {
  tag: string;
  content: CommentDisplayPart[];
}

export interface ExternalTarget {
  packageName: string;
  packagePath: string;
  qualifiedName: string;
}

export interface SymbolId {
  packageName: string;
  packagePath: string;
  qualifiedName: string;
}

// ---------------------------------------------------------------------------
// Type variants
// ---------------------------------------------------------------------------

export type TypeDocType =
  | IntrinsicType
  | LiteralType
  | UnionType
  | IntersectionType
  | ArrayType
  | ReferenceType
  | ReflectionType
  | TupleType
  | TypeOperatorType
  | QueryType
  | PredicateType
  | ConditionalType
  | IndexedAccessType
  | MappedType
  | TemplateLiteralType
  | NamedTupleMemberType
  | OptionalType
  | RestType
  | UnknownType;

export interface IntrinsicType {
  type: "intrinsic";
  name: string;
}

export interface LiteralType {
  type: "literal";
  value: string | number | boolean | null;
}

export interface UnionType {
  type: "union";
  types: TypeDocType[];
}

export interface IntersectionType {
  type: "intersection";
  types: TypeDocType[];
}

export interface ArrayType {
  type: "array";
  elementType: TypeDocType;
}

export interface ReferenceType {
  type: "reference";
  target: number | ExternalTarget;
  name: string;
  package?: string;
  typeArguments?: TypeDocType[];
  qualifiedName?: string;
}

export interface ReflectionType {
  type: "reflection";
  declaration: Reflection;
}

export interface TupleType {
  type: "tuple";
  elements?: TypeDocType[];
}

export interface TypeOperatorType {
  type: "typeOperator";
  operator: string;
  target: TypeDocType;
}

export interface QueryType {
  type: "query";
  queryType: TypeDocType;
}

export interface PredicateType {
  type: "predicate";
  name: string;
  asserts?: boolean;
  targetType?: TypeDocType;
}

export interface ConditionalType {
  type: "conditional";
  checkType: TypeDocType;
  extendsType: TypeDocType;
  trueType: TypeDocType;
  falseType: TypeDocType;
}

export interface IndexedAccessType {
  type: "indexedAccess";
  objectType: TypeDocType;
  indexType: TypeDocType;
}

export interface MappedType {
  type: "mapped";
  parameter: string;
  parameterType: TypeDocType;
  templateType: TypeDocType;
}

export interface TemplateLiteralType {
  type: "templateLiteral";
  head: string;
  tail: Array<[TypeDocType, string]>;
}

export interface NamedTupleMemberType {
  type: "namedTupleMember";
  name: string;
  isOptional?: boolean;
  element: TypeDocType;
}

export interface OptionalType {
  type: "optional";
  elementType: TypeDocType;
}

export interface RestType {
  type: "rest";
  elementType: TypeDocType;
}

export interface UnknownType {
  type: "unknown";
  name: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isExternalTarget(
  target: number | ExternalTarget | undefined,
): target is ExternalTarget {
  return typeof target === "object" && target !== null && "packageName" in target;
}

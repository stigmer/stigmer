/**
 * Re-export TypeDoc JSON v2 schema types shared with the React SDK generator.
 */
export type {
  TypeDocProject,
  Reflection,
  ReflectionFlags,
  ReflectionGroup,
  Source,
  Comment,
  CommentDisplayPart,
  BlockTag,
  ExternalTarget,
  SymbolId,
  TypeDocType,
  ReferenceType,
  ReflectionType,
} from "../generate-react-sdk-docs/typedoc-types";

export { ReflectionKind, isExternalTarget } from "../generate-react-sdk-docs/typedoc-types";

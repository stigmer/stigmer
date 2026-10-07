// Schema loading for the Stage 2 generator: the committed JSON files under
// tools/codegen/schemas are the generator's only structural input (the
// SpecSchema/TypeSchema/FieldSchema types, as interfaces over the parsed
// JSON).

import * as fs from "node:fs";

export interface SpecSchema {
  name: string;
  description: string;
  protoType: string;
  protoFile: string;
  fields: FieldSchema[];
}

export interface TypeSchema {
  name: string;
  description: string;
  protoType: string;
  protoFile: string;
  fields: FieldSchema[];
  /** Derived at load time from the proto namespace, not part of the JSON. */
  domain?: string;
}

export interface FieldSchema {
  name: string;
  jsonName: string;
  protoField: string;
  type: TypeSpec;
  description: string;
  required: boolean;
  referenceKind?: number;
  oneofGroup?: string;
  validation?: Validation;
}

export interface TypeSpec {
  kind: string;
  keyType?: TypeSpec;
  valueType?: TypeSpec;
  elementType?: TypeSpec;
  messageType?: string;
  enumType?: string;
  enumValues?: string[];
}

export interface Validation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  minItems?: number;
  maxItems?: number;
  enum?: string[];
}

/** Directory entries in sorted order — Go's os.ReadDir contract. */
export function readDirSorted(dir: string): fs.Dirent[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

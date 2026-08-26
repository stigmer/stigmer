// Extension readers for the schema extractor.
//
// The extension DEFINITIONS (buf.validate.field and the stigmer custom
// options) arrive in the CodeGeneratorRequest as compiled files, so they are
// resolved from the request's own registry instead of being compiled in.
// This replaces two mechanisms in the retired Go extractor: the typed
// protovalidate getters, and — for the custom options — raw unknown-field
// wire walking (including the text-format string-match it used for
// is_expression, oss history). Reading through the registry is
// output-identical and strictly less fragile.
//
// Byte-parity quirks preserved deliberately (see the project plan):
//   - numeric rules use `!= 0` value guards, so a genuine `gte: 0` is
//     dropped, while string/bytes rules use presence checks, so a
//     `min_len: 0` is kept;
//   - float/double bounds truncate toward zero to integers;
//   - gt/lt convert to inclusive bounds via ±1.

import type { DescExtension, DescField, DescMessage, FileRegistry } from "@bufbuild/protobuf";
import { getExtension, hasExtension } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectList, ReflectMessage } from "@bufbuild/protobuf/reflect";
import type { Message } from "@bufbuild/protobuf";

// Extension field numbers on google.protobuf.FieldOptions / MessageOptions.
const BUF_VALIDATE_FIELD = 1159;
const IS_EXPRESSION = 90203;
const REFERENCE_KIND = 90204;
const DISCRIMINATED_BY = 90205;
const DISCRIMINATOR_VALUE = 90301;

/** Validation rules in the exact shape the Go extractor captured. */
export interface ValidationRules {
  required: boolean;
  minLength: number;
  maxLength: number;
  pattern: string;
  min: number;
  max: number;
  minItems: number;
  maxItems: number;
  enum: string[];
}

export class OptionsReader {
  private readonly validateExt: DescExtension | undefined;
  private readonly isExpressionExt: DescExtension | undefined;
  private readonly referenceKindExt: DescExtension | undefined;
  private readonly discriminatedByExt: DescExtension | undefined;
  private readonly discriminatorValueExt: DescExtension | undefined;

  constructor(registry: FileRegistry) {
    const fieldOptions = registry.getMessage("google.protobuf.FieldOptions");
    const messageOptions = registry.getMessage("google.protobuf.MessageOptions");
    this.validateExt = fieldOptions && registry.getExtensionFor(fieldOptions, BUF_VALIDATE_FIELD);
    this.isExpressionExt = fieldOptions && registry.getExtensionFor(fieldOptions, IS_EXPRESSION);
    this.referenceKindExt = fieldOptions && registry.getExtensionFor(fieldOptions, REFERENCE_KIND);
    this.discriminatedByExt = fieldOptions && registry.getExtensionFor(fieldOptions, DISCRIMINATED_BY);
    this.discriminatorValueExt =
      messageOptions && registry.getExtensionFor(messageOptions, DISCRIMINATOR_VALUE);
  }

  /** Port of extractValidation: buf.validate rules, or null when none captured. */
  validation(field: DescField): ValidationRules | null {
    const rules = this.reflectExtension(field.proto.options, this.validateExt);
    if (rules === undefined) return null;

    const v: ValidationRules = {
      required: false,
      minLength: 0,
      maxLength: 0,
      pattern: "",
      min: 0,
      max: 0,
      minItems: 0,
      maxItems: 0,
      enum: [],
    };
    let hasValidation = false;

    if (getBool(rules, "required")) {
      v.required = true;
      hasValidation = true;
    }

    const str = getMessage(rules, "string");
    if (str !== undefined) {
      if (isSet(str, "min_len")) {
        v.minLength = getInt(str, "min_len");
        hasValidation = true;
      }
      if (isSet(str, "max_len")) {
        v.maxLength = getInt(str, "max_len");
        hasValidation = true;
      }
      if (isSet(str, "pattern")) {
        v.pattern = getString(str, "pattern");
        hasValidation = true;
      }
      const inValues = getStringList(str, "in");
      if (inValues.length > 0) {
        v.enum = inValues;
        hasValidation = true;
      }
    }

    for (const group of ["int32", "int64"] as const) {
      const rulesMsg = getMessage(rules, group);
      if (rulesMsg === undefined) continue;
      const gte = getInt(rulesMsg, "gte");
      if (gte !== 0) {
        v.min = gte;
        hasValidation = true;
      }
      const lte = getInt(rulesMsg, "lte");
      if (lte !== 0) {
        v.max = lte;
        hasValidation = true;
      }
      const gt = getInt(rulesMsg, "gt");
      if (gt !== 0) {
        v.min = gt + 1;
        hasValidation = true;
      }
      const lt = getInt(rulesMsg, "lt");
      if (lt !== 0) {
        v.max = lt - 1;
        hasValidation = true;
      }
    }

    for (const group of ["float", "double"] as const) {
      const rulesMsg = getMessage(rules, group);
      if (rulesMsg === undefined) continue;
      const gte = getFloat(rulesMsg, "gte");
      if (gte !== 0) {
        v.min = Math.trunc(gte);
        hasValidation = true;
      }
      const lte = getFloat(rulesMsg, "lte");
      if (lte !== 0) {
        v.max = Math.trunc(lte);
        hasValidation = true;
      }
    }

    const repeated = getMessage(rules, "repeated");
    if (repeated !== undefined) {
      const minItems = getInt(repeated, "min_items");
      if (minItems !== 0) {
        v.minItems = minItems;
        hasValidation = true;
      }
      const maxItems = getInt(repeated, "max_items");
      if (maxItems !== 0) {
        v.maxItems = maxItems;
        hasValidation = true;
      }
    }

    const map = getMessage(rules, "map");
    if (map !== undefined) {
      const minPairs = getInt(map, "min_pairs");
      if (minPairs !== 0) {
        v.minItems = minPairs;
        hasValidation = true;
      }
      const maxPairs = getInt(map, "max_pairs");
      if (maxPairs !== 0) {
        v.maxItems = maxPairs;
        hasValidation = true;
      }
    }

    const bytes = getMessage(rules, "bytes");
    if (bytes !== undefined) {
      if (isSet(bytes, "min_len")) {
        v.minLength = getInt(bytes, "min_len");
        hasValidation = true;
      }
      if (isSet(bytes, "max_len")) {
        v.maxLength = getInt(bytes, "max_len");
        hasValidation = true;
      }
      if (isSet(bytes, "pattern")) {
        v.pattern = getString(bytes, "pattern");
        hasValidation = true;
      }
    }

    return hasValidation ? v : null;
  }

  isExpression(field: DescField): boolean {
    const value = this.scalarExtension(field.proto.options, this.isExpressionExt);
    return value === true;
  }

  referenceKind(field: DescField): number {
    const value = this.scalarExtension(field.proto.options, this.referenceKindExt);
    return typeof value === "number" ? value : 0;
  }

  discriminatedBy(field: DescField): string {
    const value = this.scalarExtension(field.proto.options, this.discriminatedByExt);
    return typeof value === "string" ? value : "";
  }

  discriminatorValue(msg: DescMessage): string {
    const value = this.scalarExtension(msg.proto.options, this.discriminatorValueExt);
    return typeof value === "string" ? value : "";
  }

  private scalarExtension(options: Message | undefined, ext: DescExtension | undefined): unknown {
    if (options === undefined || ext === undefined) return undefined;
    if (!hasExtension(options, ext)) return undefined;
    return getExtension(options, ext);
  }

  private reflectExtension(
    options: Message | undefined,
    ext: DescExtension | undefined,
  ): ReflectMessage | undefined {
    if (options === undefined || ext === undefined || ext.message === undefined) return undefined;
    if (!hasExtension(options, ext)) return undefined;
    const value = getExtension(options, ext) as Message;
    return reflect(ext.message, value);
  }
}

function fieldByName(msg: ReflectMessage, name: string) {
  const field = msg.desc.fields.find((f) => f.name === name);
  if (field === undefined) {
    throw new Error(`buf.validate descriptor has no field "${name}" on ${msg.desc.typeName}`);
  }
  return field;
}

function isSet(msg: ReflectMessage, name: string): boolean {
  return msg.isSet(fieldByName(msg, name));
}

function getBool(msg: ReflectMessage, name: string): boolean {
  return msg.get(fieldByName(msg, name)) === true;
}

function getString(msg: ReflectMessage, name: string): string {
  const value = msg.get(fieldByName(msg, name));
  return typeof value === "string" ? value : "";
}

// Go read int32/int64/uint64 rule values through int conversion; 64-bit
// values surface as bigint in protobuf-es and are safely small here.
function getInt(msg: ReflectMessage, name: string): number {
  const value = msg.get(fieldByName(msg, name));
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function getFloat(msg: ReflectMessage, name: string): number {
  const value = msg.get(fieldByName(msg, name));
  return typeof value === "number" ? value : 0;
}

function getStringList(msg: ReflectMessage, name: string): string[] {
  const value = msg.get(fieldByName(msg, name)) as ReflectList;
  const out: string[] = [];
  for (let i = 0; i < value.size; i++) {
    const item = value.get(i);
    if (typeof item === "string") out.push(item);
  }
  return out;
}

/** Port of extractValidation's message-level sibling for group presence. */
function getMessage(msg: ReflectMessage, name: string): ReflectMessage | undefined {
  const field = fieldByName(msg, name);
  if (!msg.isSet(field)) return undefined;
  const value = msg.get(field);
  return value as ReflectMessage;
}

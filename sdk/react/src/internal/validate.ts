import {
  createValidator,
  type Violation,
} from "@bufbuild/protovalidate";
import { pathToString } from "@bufbuild/protobuf/reflect";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

const validator = createValidator();

/**
 * Validates a proto message against its schema-defined buf.validate constraints.
 *
 * Returns an empty array when valid, or an array of {@link Violation} objects.
 * This uses the same validation engine as the backend (protovalidate), ensuring
 * frontend and backend validation are always consistent.
 */
export function validateMessage<Desc extends DescMessage>(
  schema: Desc,
  message: MessageShape<Desc>,
): Violation[] {
  const result = validator.validate(schema, message);
  if (result.kind === "invalid") {
    return result.violations;
  }
  return [];
}

/**
 * Extracts the first violation message for a given field path.
 *
 * @param violations - Array of violations from {@link validateMessage}
 * @param fieldPath - Dot-separated field path (e.g., "slug", "metadata.slug")
 * @returns The first violation message for that field, or `null` if none.
 */
export function getFieldError(
  violations: Violation[],
  fieldPath: string,
): string | null {
  for (const v of violations) {
    if (pathToString(v.field) === fieldPath) {
      return v.message;
    }
  }
  return null;
}

/**
 * Extracts all violation messages for a given field path.
 *
 * @param violations - Array of violations from {@link validateMessage}
 * @param fieldPath - Dot-separated field path (e.g., "slug", "metadata.slug")
 * @returns Array of violation messages (empty if none).
 */
export function getFieldErrors(
  violations: Violation[],
  fieldPath: string,
): string[] {
  const errors: string[] = [];
  for (const v of violations) {
    if (pathToString(v.field) === fieldPath) {
      errors.push(v.message);
    }
  }
  return errors;
}

/**
 * Cross-edition violation rendering — ports FormatViolation from
 * pkg/domain/workflow/validation/task_config_constraints.go. Renders one
 * protovalidate violation as "<field.path> – <message>", matching the Go
 * and Cloud Java formatters exactly (en-dash separator, "<message>"
 * sentinel when the rule is message-level, and [index] / ['key'] subscripts
 * for repeated/map elements) — see prettyPrint / renderPath in
 * backend/libs/java/utils/.../ProtoMessageFieldsValidator.java. All three
 * editions emit identical strings for the same violation at Layer 1
 * (validateSpec's folded whole-resource pass) and Layer 2 (typed task
 * configs); the conformance suite pins the exact string (#805). Keep the
 * formatters in lockstep.
 *
 * WATCH ITEM (carried from sub-project #4): the <message> half is
 * protovalidate's text. Authored CEL messages (what the suite pins) are
 * identical across editions by construction; protovalidate-es's
 * library-generated messages for STANDARD rules could drift from
 * protovalidate-go's — any such divergence surfaces at the conformance
 * gate and goes to the owner.
 */
import type { Violation } from "@bufbuild/protovalidate";
import { violationToProto } from "@bufbuild/protovalidate";

/** The en-dash separator both peer formatters use. */
const SEPARATOR = " \u2013 ";

export function formatViolation(violation: Violation): string {
  // The proto form carries the same FieldPath elements Go's formatter
  // walks (field name or number, plus the subscript oneof).
  const [proto] = violationToProto(violation);
  const message = proto.message ?? "";
  if (proto.field === undefined) {
    return `<message>${SEPARATOR}${message}`;
  }

  const parts: string[] = [];
  for (const el of proto.field.elements) {
    // Prefer the field name; fall back to the field number when unknown.
    let rendered = el.fieldName ?? String(el.fieldNumber ?? "");
    switch (el.subscript.case) {
      case "index":
        rendered += `[${el.subscript.value}]`;
        break;
      case "boolKey":
        rendered += `[${el.subscript.value}]`;
        break;
      case "intKey":
        rendered += `[${el.subscript.value}]`;
        break;
      case "uintKey":
        rendered += `[${el.subscript.value}]`;
        break;
      case "stringKey":
        rendered += `['${el.subscript.value}']`;
        break;
    }
    parts.push(rendered);
  }

  return parts.join(".") + SEPARATOR + message;
}

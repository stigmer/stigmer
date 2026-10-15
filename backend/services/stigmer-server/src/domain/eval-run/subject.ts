/**
 * What an eval run is about, read off its spec's subject oneof: an agent,
 * or a plugin run on the built-in assistant. Every reader asks here rather
 * than switching on the oneof itself, so "no subject" has one answer.
 *
 * Proven by __tests__/subject.test.ts.
 */
import type { EvalRunSpec } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";

/** An eval run's subject. */
export type EvalRunSubject =
  | { readonly kind: "agent"; readonly id: string }
  | { readonly kind: "plugin"; readonly id: string };

/** The subject a spec names; undefined when it names none or names one by an empty id. */
export function subjectOf(spec: Pick<EvalRunSpec, "subject"> | undefined): EvalRunSubject | undefined {
  const subject = spec?.subject;
  switch (subject?.case) {
    case "agentId":
      return subject.value === "" ? undefined : { kind: "agent", id: subject.value };
    case "pluginId":
      return subject.value === "" ? undefined : { kind: "plugin", id: subject.value };
    default:
      return undefined;
  }
}

/** The agent an eval run is about; "" when it is about a plugin or nothing. */
export function agentIdOf(spec: Pick<EvalRunSpec, "subject"> | undefined): string {
  const subject = subjectOf(spec);
  return subject?.kind === "agent" ? subject.id : "";
}

/** The plugin an eval run is about; "" when it is about an agent or nothing. */
export function pluginIdOf(spec: Pick<EvalRunSpec, "subject"> | undefined): string {
  const subject = subjectOf(spec);
  return subject?.kind === "plugin" ? subject.id : "";
}

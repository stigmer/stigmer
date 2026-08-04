// CLI verbs — operations that can be performed on a resource.

export const Verb = {
  Apply: "apply",
  Validate: "validate",
  Get: "get",
  List: "list",
  Delete: "delete",
  Run: "run",
  Push: "push",
  Search: "search",
  Download: "download",
} as const;

export type Verb = (typeof Verb)[keyof typeof Verb];

// Declaration order is the canonical display order (help text, parity tables).
export const ALL_VERBS: readonly Verb[] = [
  Verb.Apply,
  Verb.Validate,
  Verb.Get,
  Verb.List,
  Verb.Delete,
  Verb.Run,
  Verb.Push,
  Verb.Search,
  Verb.Download,
];

export function isFileBasedVerb(verb: Verb): boolean {
  return verb === Verb.Apply || verb === Verb.Validate;
}

export function isReferenceBasedVerb(verb: Verb): boolean {
  return (
    verb === Verb.Get ||
    verb === Verb.Delete ||
    verb === Verb.Run ||
    verb === Verb.Search ||
    verb === Verb.Download
  );
}

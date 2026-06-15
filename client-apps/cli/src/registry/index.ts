// Public surface of the type-registry module.

export { generateAliases, normalizeAlias, pluralize, toKebabCase, toSnakeCase } from "./aliases.js";
export { CLI_RELEVANT_KINDS, type KindMeta, KIND_META } from "./metadata.js";
export { defaultRegistry, type Registry, supportsVerb, type TypeInfo } from "./registry.js";
export { ALL_VERBS, isFileBasedVerb, isReferenceBasedVerb, Verb } from "./verbs.js";
export { VERB_SUPPORT, verbsForKind } from "./verb-support.js";

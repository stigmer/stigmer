// Manifest engine: kind-agnostic YAML ⇄ proto ⇄ apply for Stigmer resources.
//
// The declarative counterpart to the typed per-kind clients — parse a YAML
// manifest against generated proto schemas, serialize server state back to
// editable YAML, and apply through each kind's command controller.

export {
  manifestKinds,
  manifestHandlerForYamlKind,
  manifestHandlerForTypeName,
} from "./registry.js";
export type { ManifestKindHandler, ServiceClientFn } from "./registry.js";

export { parseManifest, metadataOf } from "./parse.js";
export type { ManifestDocument, ParseManifestOptions } from "./parse.js";

export { manifestDocumentForResource } from "./document.js";

export { serializeManifest } from "./serialize.js";

export { ManifestClient } from "./client.js";
export type { AppliedManifest } from "./client.js";

export {
  REDACTED_SECRET_MARKER,
  containsRedactedSecrets,
} from "./redaction.js";

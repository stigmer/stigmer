// Manifest domain: the console-facing YAML edit/apply experience for every
// registry-supported resource kind, built on the @stigmer/sdk manifest
// engine (parseManifest / serializeManifest / stigmer.manifest).
//
// Headless-first (DD-003): the hooks are independently importable; the
// dialogs compose them with the shared YamlEditor.

export { YamlEditor } from "./YamlEditor.js";
export type { YamlEditorProps } from "./YamlEditor.js";

export { useEditResourceYaml } from "./useEditResourceYaml.js";
export type {
  EditYamlTarget,
  EditYamlValidation,
  UseEditResourceYamlOptions,
  UseEditResourceYamlReturn,
} from "./useEditResourceYaml.js";

export { useApplyManifest } from "./useApplyManifest.js";
export type {
  ManifestEntryStatus,
  ManifestPreviewEntry,
  UseApplyManifestReturn,
} from "./useApplyManifest.js";

export { EditResourceYamlDialog } from "./EditResourceYamlDialog.js";
export type { EditResourceYamlDialogProps } from "./EditResourceYamlDialog.js";

export { ApplyManifestDialog } from "./ApplyManifestDialog.js";
export type { ApplyManifestDialogProps } from "./ApplyManifestDialog.js";

export { RedactedSecretsNotice } from "./RedactedSecretsNotice.js";
export type { RedactedSecretsNoticeProps } from "./RedactedSecretsNotice.js";

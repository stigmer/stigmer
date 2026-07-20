// The schema-aware YAML editor started life here (T10) and was promoted to
// the manifest domain when resource YAML editing became a cross-kind
// concern. These aliases keep the original workflow-scoped names stable —
// both are public API (exported from the package index).

export { YamlEditor as WorkflowYamlEditor } from "../manifest/YamlEditor.js";
export type { YamlEditorProps as WorkflowYamlEditorProps } from "../manifest/YamlEditor.js";

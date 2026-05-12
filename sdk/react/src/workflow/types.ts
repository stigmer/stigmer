/**
 * TypeScript representation of a TaskKindDescriptor from the task kind registry.
 *
 * Each descriptor provides complete metadata for a single workflow task kind,
 * enabling UI form generation, YAML editor autocomplete, task palette
 * rendering, and client-side pre-validation.
 *
 * @since T04 (Task Schema Registry)
 */
export interface TaskKindDescriptor {
  /** Workflow task kind identifier (e.g., "llm_call", "human_input"). */
  readonly kind: string;
  /** Human-readable display name (e.g., "LLM Call", "Human Input"). */
  readonly displayName: string;
  /** One-line description of what this task kind does. */
  readonly description: string;
  /** Functional category for palette grouping and filtering. */
  readonly category: TaskKindCategory;
  /** Lucide icon name for UI rendering. */
  readonly icon: string;
  /** Fully-qualified proto message type for the task config. */
  readonly configProtoType: string;
  /** Ordered field descriptors for form rendering. */
  readonly fields: readonly TaskFieldDescriptor[];
  /** Logical field groups for form section rendering. */
  readonly fieldGroups: readonly TaskFieldGroup[];
  /** JSON Schema (draft 2020-12) for the task_config payload. */
  readonly configJsonSchema: Record<string, unknown>;
  /** JSON Schema describing the task's output shape. */
  readonly outputJsonSchema?: Record<string, unknown>;
  /** YAML code examples demonstrating common usage patterns. */
  readonly yamlExamples?: readonly string[];
  /** Documentation URL path (relative to docs root). */
  readonly documentationUrl: string;
  /** Whether this task kind invokes AI models. */
  readonly isAiNative: boolean;
  /** Whether this task kind requires external service connectivity. */
  readonly requiresExternalService: boolean;
}

/** Functional category for grouping task kinds in the UI. */
export type TaskKindCategory =
  | "control_flow"
  | "invocation"
  | "ai"
  | "data"
  | "governance"
  | "event"
  | "unspecified";

/** Describes a single field in a task configuration message. */
export interface TaskFieldDescriptor {
  /** Proto field name (snake_case). */
  readonly name: string;
  /** Human-readable label for form rendering. */
  readonly displayName: string;
  /** Field description from proto comments. */
  readonly description: string;
  /** Data type for rendering the appropriate form control. */
  readonly type: TaskFieldType;
  /** Whether the field is required. */
  readonly required: boolean;
  /** Whether the field accepts ${ } expression interpolation. */
  readonly isExpression?: boolean;
  /** Default value as a JSON-encoded string. */
  readonly defaultValue?: string;
  /** Valid enum values when type is "enum". */
  readonly enumValues?: readonly string[];
  /** Group this field belongs to for form section rendering. */
  readonly groupId?: string;
  /** Proto field number for stable identification. */
  readonly fieldNumber: number;
  /** For repeated: the element type. For message: the nested type name. */
  readonly elementType?: string;
  /** Human-readable validation constraint descriptions. */
  readonly validationHints?: readonly string[];
}

/** Data type of a task configuration field. */
export type TaskFieldType =
  | "string"
  | "int32"
  | "float"
  | "bool"
  | "enum"
  | "struct"
  | "repeated"
  | "map"
  | "message";

/** Logical grouping of fields for form section rendering. */
export interface TaskFieldGroup {
  /** Group identifier. */
  readonly id: string;
  /** Human-readable label for the group section header. */
  readonly displayName: string;
  /** Optional description shown below the group header. */
  readonly description?: string;
}

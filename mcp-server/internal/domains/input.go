package domains

// ResourceIdentity holds the common identity and metadata fields shared by all
// API resource apply inputs. Domain-specific input types embed this struct so
// the LLM sees a flat, consistent set of identity fields across every apply tool.
//
// Embedded structs are flattened by both encoding/json and jsonschema-go, so the
// fields appear at the top level of the tool's JSON Schema.
type ResourceIdentity struct {
	Name       string            `json:"name" jsonschema:"required,description=Human-readable name of the resource."`
	Slug       string            `json:"slug,omitempty" jsonschema:"description=URL-friendly identifier (lowercase alphanumeric with hyphens). Auto-generated from name if omitted."`
	Org        string            `json:"org" jsonschema:"required,description=Organization that owns this resource (e.g. acme)."`
	Visibility string            `json:"visibility,omitempty" jsonschema:"description=Resource visibility: PRIVATE (default) or PUBLIC."`
	Labels     map[string]string `json:"labels,omitempty" jsonschema:"description=Key-value labels for organization and filtering."`
	Tags       []string          `json:"tags,omitempty" jsonschema:"description=Tags for categorization and discovery."`
}

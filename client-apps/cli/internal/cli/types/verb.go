package types

// Verb represents a CLI operation that can be performed on a resource.
type Verb string

const (
	// VerbApply creates or updates a resource from a file.
	// For Project kind, this triggers SDK synthesis mode.
	VerbApply Verb = "apply"

	// VerbValidate validates a resource file without applying.
	VerbValidate Verb = "validate"

	// VerbGet retrieves a single resource by ID or org/slug.
	VerbGet Verb = "get"

	// VerbList lists all resources of a type.
	VerbList Verb = "list"

	// VerbDelete removes a resource by ID or org/slug.
	VerbDelete Verb = "delete"

	// VerbRun executes a resource (e.g., agent, workflow).
	VerbRun Verb = "run"

	// VerbPush pushes a resource to the registry (e.g., skill).
	VerbPush Verb = "push"

	// VerbSearch searches for resources by query.
	VerbSearch Verb = "search"
)

// String returns the string representation of the verb.
func (v Verb) String() string {
	return string(v)
}

// AllVerbs returns all available verbs.
func AllVerbs() []Verb {
	return []Verb{
		VerbApply,
		VerbValidate,
		VerbGet,
		VerbList,
		VerbDelete,
		VerbRun,
		VerbPush,
		VerbSearch,
	}
}

// IsFileBasedVerb returns true if the verb operates on files.
func (v Verb) IsFileBasedVerb() bool {
	return v == VerbApply || v == VerbValidate
}

// IsReferenceBasedVerb returns true if the verb operates on resource references.
func (v Verb) IsReferenceBasedVerb() bool {
	return v == VerbGet || v == VerbDelete || v == VerbRun || v == VerbSearch
}

// IsListVerb returns true if the verb lists resources.
func (v Verb) IsListVerb() bool {
	return v == VerbList
}

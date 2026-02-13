package types

import "fmt"

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

	// VerbDownload downloads artifacts from an execution.
	VerbDownload Verb = "download"
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
		VerbDownload,
	}
}

// IsFileBasedVerb returns true if the verb operates on files.
func (v Verb) IsFileBasedVerb() bool {
	return v == VerbApply || v == VerbValidate
}

// IsReferenceBasedVerb returns true if the verb operates on resource references.
func (v Verb) IsReferenceBasedVerb() bool {
	return v == VerbGet || v == VerbDelete || v == VerbRun || v == VerbSearch || v == VerbDownload
}

// IsListVerb returns true if the verb lists resources.
func (v Verb) IsListVerb() bool {
	return v == VerbList
}

// VerbFromString parses a string into a Verb.
// Returns an error if the string is not a valid verb.
func VerbFromString(s string) (Verb, error) {
	switch s {
	case "apply":
		return VerbApply, nil
	case "validate":
		return VerbValidate, nil
	case "get":
		return VerbGet, nil
	case "list":
		return VerbList, nil
	case "delete":
		return VerbDelete, nil
	case "run":
		return VerbRun, nil
	case "push":
		return VerbPush, nil
	case "search":
		return VerbSearch, nil
	case "download":
		return VerbDownload, nil
	default:
		return "", fmt.Errorf("unknown verb: %s", s)
	}
}

// AllVerbNames returns all verb names as strings.
func AllVerbNames() []string {
	verbs := AllVerbs()
	names := make([]string, len(verbs))
	for i, v := range verbs {
		names[i] = v.String()
	}
	return names
}

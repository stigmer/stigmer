// Package reconcile provides value objects and services for reconciling Project resources.
//
// The reconciliation engine compares desired state (from Project.Spec) with actual state
// (fetched from repositories) and computes a plan to align them. This package provides
// the foundational value objects used throughout the reconciliation process.
package reconcile

import (
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Supported resource kinds for reconciliation.
// These are the resource types that can be embedded in a Project.Spec.
var supportedKinds = map[apiresourcekind.ApiResourceKind]string{
	apiresourcekind.ApiResourceKind_agent:      "agent",
	apiresourcekind.ApiResourceKind_workflow:   "workflow",
	apiresourcekind.ApiResourceKind_mcp_server: "mcp_server",
	apiresourcekind.ApiResourceKind_skill:      "skill",
}

// kindStringToEnum maps kind string names to their enum values.
var kindStringToEnum = map[string]apiresourcekind.ApiResourceKind{
	"agent":      apiresourcekind.ApiResourceKind_agent,
	"workflow":   apiresourcekind.ApiResourceKind_workflow,
	"mcp_server": apiresourcekind.ApiResourceKind_mcp_server,
	"skill":      apiresourcekind.ApiResourceKind_skill,
}

// ResourceKey is a type-safe composite key "{kind}:{slug}" for reconciliation.
//
// ResourceKey uniquely identifies a resource within a Project's scope. It combines
// the resource kind (agent, workflow, mcp_server, skill) with its slug to form
// a composite key that can be used for O(1) lookups in state maps and as nodes
// in the dependency graph.
//
// This is an immutable value object - all fields are set at construction and
// there are no setters. ResourceKey implements fmt.Stringer and is comparable,
// so it can be used as a map key.
//
// Format: "{kind}:{slug}" (e.g., "agent:my-agent", "workflow:data-pipeline")
type ResourceKey struct {
	kind apiresourcekind.ApiResourceKind
	slug string
}

// NewResourceKey creates a new ResourceKey with the given kind and slug.
//
// Returns an error if:
//   - The slug is empty
//   - The kind is not one of: agent, workflow, mcp_server, skill
//
// Example:
//
//	key, err := NewResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
//	if err != nil {
//	    return err
//	}
//	fmt.Println(key) // Output: agent:my-agent
func NewResourceKey(kind apiresourcekind.ApiResourceKind, slug string) (ResourceKey, error) {
	if slug == "" {
		return ResourceKey{}, fmt.Errorf("resource key slug cannot be empty")
	}

	if _, ok := supportedKinds[kind]; !ok {
		return ResourceKey{}, fmt.Errorf("unsupported resource kind for reconciliation: %v", kind)
	}

	return ResourceKey{kind: kind, slug: slug}, nil
}

// MustResourceKey creates a new ResourceKey, panicking if the arguments are invalid.
//
// This is intended for use in tests and static initialization where the arguments
// are known to be valid at compile time.
//
// Example:
//
//	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "test-agent")
func MustResourceKey(kind apiresourcekind.ApiResourceKind, slug string) ResourceKey {
	key, err := NewResourceKey(kind, slug)
	if err != nil {
		panic(err)
	}
	return key
}

// ParseResourceKey parses a string in "{kind}:{slug}" format into a ResourceKey.
//
// Returns an error if:
//   - The string does not contain exactly one colon
//   - The kind portion is empty or not recognized
//   - The slug portion is empty
//
// Example:
//
//	key, err := ParseResourceKey("agent:my-agent")
//	if err != nil {
//	    return err
//	}
//	fmt.Println(key.Kind()) // Output: agent
//	fmt.Println(key.Slug()) // Output: my-agent
func ParseResourceKey(s string) (ResourceKey, error) {
	colonIndex := strings.Index(s, ":")
	if colonIndex <= 0 {
		return ResourceKey{}, fmt.Errorf("invalid resource key format %q: missing kind before colon", s)
	}
	if colonIndex >= len(s)-1 {
		return ResourceKey{}, fmt.Errorf("invalid resource key format %q: missing slug after colon", s)
	}

	kindStr := s[:colonIndex]
	slug := s[colonIndex+1:]

	kind, ok := kindStringToEnum[kindStr]
	if !ok {
		return ResourceKey{}, fmt.Errorf("invalid resource key format %q: unknown kind %q", s, kindStr)
	}

	return ResourceKey{kind: kind, slug: slug}, nil
}

// Kind returns the resource kind (agent, workflow, mcp_server, or skill).
func (k ResourceKey) Kind() apiresourcekind.ApiResourceKind {
	return k.kind
}

// Slug returns the resource slug (unique identifier within the kind).
func (k ResourceKey) Slug() string {
	return k.slug
}

// String returns the key in "{kind}:{slug}" format.
//
// Implements fmt.Stringer for clean printing and logging.
func (k ResourceKey) String() string {
	kindStr, ok := supportedKinds[k.kind]
	if !ok {
		// This should never happen if the key was constructed properly
		kindStr = "unknown"
	}
	return kindStr + ":" + k.slug
}

// IsZero returns true if this is a zero-value ResourceKey.
func (k ResourceKey) IsZero() bool {
	return k.slug == ""
}

package types

import (
	"strings"
	"sync"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
)

// Registry provides type information for CLI commands.
type Registry interface {
	// GetByProtoKind returns info for a proto ApiResourceKind.
	GetByProtoKind(kind apiresourcekind.ApiResourceKind) *TypeInfo

	// GetByAlias returns info by any alias (case-insensitive).
	// Accepts variations like "mcp-server", "mcpserver", "MCP", etc.
	GetByAlias(input string) (*TypeInfo, bool)

	// GetByYAMLKind returns info by YAML kind string (e.g., "McpServer").
	GetByYAMLKind(yamlKind string) (*TypeInfo, bool)

	// All returns all registered CLI-relevant types.
	All() []*TypeInfo

	// SupportsVerb checks if a type supports a verb.
	SupportsVerb(kind apiresourcekind.ApiResourceKind, verb Verb) bool

	// TypesForVerb returns all types supporting a verb.
	TypesForVerb(verb Verb) []apiresourcekind.ApiResourceKind
}

// registry is the concrete implementation of Registry.
type registry struct {
	byProtoKind map[apiresourcekind.ApiResourceKind]*TypeInfo
	byAlias     map[string]*TypeInfo // lowercase alias -> TypeInfo
	byYAMLKind  map[string]*TypeInfo // exact YAML kind -> TypeInfo
	allTypes    []*TypeInfo
}

// defaultRegistry is the singleton registry instance.
var (
	defaultRegistry     *registry
	defaultRegistryOnce sync.Once
)

// DefaultRegistry returns the singleton registry built from proto metadata.
func DefaultRegistry() Registry {
	defaultRegistryOnce.Do(func() {
		defaultRegistry = buildRegistry()
	})
	return defaultRegistry
}

// cliRelevantKinds lists the resource kinds that are user-facing in the CLI.
var cliRelevantKinds = map[apiresourcekind.ApiResourceKind]bool{
	apiresourcekind.ApiResourceKind_organization:      true,
	apiresourcekind.ApiResourceKind_agent:             true,
	apiresourcekind.ApiResourceKind_workflow:          true,
	apiresourcekind.ApiResourceKind_skill:             true,
	apiresourcekind.ApiResourceKind_mcp_server:        true,
	apiresourcekind.ApiResourceKind_project:           true,
	apiresourcekind.ApiResourceKind_api_key:           true,
	apiresourcekind.ApiResourceKind_identity_provider: true,
	apiresourcekind.ApiResourceKind_oauth_app:         true,
	apiresourcekind.ApiResourceKind_environment:       true,
	apiresourcekind.ApiResourceKind_agent_instance:    true,
	apiresourcekind.ApiResourceKind_workflow_instance: true,
	apiresourcekind.ApiResourceKind_session:           true,
}

// buildRegistry creates the registry from proto metadata.
func buildRegistry() *registry {
	r := &registry{
		byProtoKind: make(map[apiresourcekind.ApiResourceKind]*TypeInfo),
		byAlias:     make(map[string]*TypeInfo),
		byYAMLKind:  make(map[string]*TypeInfo),
	}

	for kind := range cliRelevantKinds {
		info := buildTypeInfo(kind)
		if info == nil {
			continue
		}

		r.byProtoKind[kind] = info
		r.byYAMLKind[info.Name] = info
		r.allTypes = append(r.allTypes, info)

		// Register all aliases (case-insensitive)
		for _, alias := range info.Aliases {
			r.byAlias[NormalizeAlias(alias)] = info
		}
	}

	return r
}

// buildTypeInfo creates TypeInfo from proto metadata for a kind.
func buildTypeInfo(kind apiresourcekind.ApiResourceKind) *TypeInfo {
	meta, err := apiresource.GetKindMeta(kind)
	if err != nil || meta == nil {
		return nil
	}

	singular := strings.ToLower(meta.Name)
	plural := pluralize(singular)

	return &TypeInfo{
		Name:           meta.Name,
		DisplayName:    meta.DisplayName,
		IdPrefix:       meta.IdPrefix,
		Singular:       singular,
		Plural:         plural,
		Aliases:        GenerateAliases(meta.Name, meta.DisplayName, meta.IdPrefix),
		SupportedVerbs: GetVerbSupport(kind),
		ProtoKind:      kind,
	}
}

// GetByProtoKind returns info for a proto ApiResourceKind.
func (r *registry) GetByProtoKind(kind apiresourcekind.ApiResourceKind) *TypeInfo {
	return r.byProtoKind[kind]
}

// GetByAlias returns info by any alias (case-insensitive).
func (r *registry) GetByAlias(input string) (*TypeInfo, bool) {
	info, ok := r.byAlias[NormalizeAlias(input)]
	return info, ok
}

// GetByYAMLKind returns info by YAML kind string (e.g., "McpServer").
func (r *registry) GetByYAMLKind(yamlKind string) (*TypeInfo, bool) {
	info, ok := r.byYAMLKind[yamlKind]
	return info, ok
}

// All returns all registered CLI-relevant types.
func (r *registry) All() []*TypeInfo {
	result := make([]*TypeInfo, len(r.allTypes))
	copy(result, r.allTypes)
	return result
}

// SupportsVerb checks if a type supports a verb.
func (r *registry) SupportsVerb(kind apiresourcekind.ApiResourceKind, verb Verb) bool {
	info := r.byProtoKind[kind]
	if info == nil {
		return false
	}
	return info.SupportsVerb(verb)
}

// TypesForVerb returns all types supporting a verb.
func (r *registry) TypesForVerb(verb Verb) []apiresourcekind.ApiResourceKind {
	var kinds []apiresourcekind.ApiResourceKind
	for _, info := range r.allTypes {
		if info.SupportsVerb(verb) {
			kinds = append(kinds, info.ProtoKind)
		}
	}
	return kinds
}

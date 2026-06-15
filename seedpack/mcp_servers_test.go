package seedpack

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// mcpServerYAML mirrors the YAML structure for validation purposes.
// Does not import proto to keep the seedpack module dependency-free.
type mcpServerYAML struct {
	APIVersion string        `yaml:"apiVersion"`
	Kind       string        `yaml:"kind"`
	Metadata   mcpMetadata   `yaml:"metadata"`
	Spec       mcpServerSpec `yaml:"spec"`
}

type mcpMetadata struct {
	Name       string            `yaml:"name"`
	Visibility string            `yaml:"visibility"`
	Labels     map[string]string `yaml:"labels"`
	Tags       []string          `yaml:"tags"`
}

type mcpServerSpec struct {
	Description         string                    `yaml:"description"`
	IconURL             string                    `yaml:"icon_url"`
	RepositoryURL       string                    `yaml:"repository_url"`
	Tags                []string                  `yaml:"tags"`
	Stdio               *stdioConfig              `yaml:"stdio"`
	HTTP                *httpConfig               `yaml:"http"`
	Env                 map[string]envDeclaration `yaml:"env"`
	Auth                *mcpAuth                  `yaml:"auth"`
	DefaultEnabledTools []string                  `yaml:"default_enabled_tools"`
}

type stdioConfig struct {
	Command    string   `yaml:"command"`
	Args       []string `yaml:"args"`
	WorkingDir string   `yaml:"working_dir"`
}

type httpConfig struct {
	URL            string            `yaml:"url"`
	Headers        map[string]string `yaml:"headers"`
	QueryParams    map[string]string `yaml:"query_params"`
	TimeoutSeconds int               `yaml:"timeout_seconds"`
}

type envDeclaration struct {
	IsSecret    bool   `yaml:"is_secret"`
	Description string `yaml:"description"`
	Optional    bool   `yaml:"optional"`
}

type mcpAuth struct {
	OAuthAppRef       *oauthAppRef `yaml:"oauth_app_ref"`
	TargetEnvVar      string       `yaml:"target_env_var"`
	TokenLifetimeHint string       `yaml:"token_lifetime_hint"`
	ScopeHints        []string     `yaml:"scope_hints"`
	DiscoveryURL      string       `yaml:"discovery_url"`
}

type oauthAppRef struct {
	Org  string `yaml:"org"`
	Kind string `yaml:"kind"`
	Slug string `yaml:"slug"`
}

var validCategories = map[string]bool{
	"developer-tools":      true,
	"databases":            true,
	"search":               true,
	"cloud-infrastructure": true,
	"communication":        true,
	"productivity":         true,
	"web-automation":       true,
	"desktop-automation":   true,
	"monitoring":           true,
	"payments":             true,
	"design":               true,
	"ai-reasoning":         true,
	"notifications":        true,
	"scheduling":           true,
	"crm-support":          true,
}

var placeholderRegex = regexp.MustCompile(`\$\{([^}]+)\}`)

func loadAllMcpServers(t *testing.T) map[string]mcpServerYAML {
	t.Helper()
	servers := make(map[string]mcpServerYAML)

	err := fs.WalkDir(content, "mcp-servers", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || filepath.Ext(path) != ".yaml" {
			return nil
		}

		data, err := content.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}

		var server mcpServerYAML
		if err := yaml.Unmarshal(data, &server); err != nil {
			t.Errorf("YAML parse error in %s: %v", path, err)
			return nil
		}

		name := strings.TrimSuffix(filepath.Base(path), ".yaml")
		servers[name] = server
		return nil
	})
	if err != nil {
		t.Fatalf("failed to walk mcp-servers/: %v", err)
	}

	if len(servers) == 0 {
		t.Fatal("no MCP server YAMLs found in embedded filesystem")
	}

	return servers
}

func TestMcpServers_AllYAML_ParseToProto(t *testing.T) {
	servers := loadAllMcpServers(t)
	t.Logf("parsed %d MCP server definitions", len(servers))

	for name, server := range servers {
		if server.APIVersion == "" {
			t.Errorf("%s: missing apiVersion", name)
		}
		if server.Kind == "" {
			t.Errorf("%s: missing kind", name)
		}
		if server.APIVersion != "agentic.stigmer.ai/v1" {
			t.Errorf("%s: unexpected apiVersion %q (want agentic.stigmer.ai/v1)", name, server.APIVersion)
		}
		if server.Kind != "McpServer" {
			t.Errorf("%s: unexpected kind %q (want McpServer)", name, server.Kind)
		}
	}
}

func isSystemServer(server mcpServerYAML) bool {
	return server.Metadata.Labels["stigmer.ai/system"] == "true"
}

func TestMcpServers_RequiredFields(t *testing.T) {
	servers := loadAllMcpServers(t)

	for name, server := range servers {
		t.Run(name, func(t *testing.T) {
			if server.Metadata.Name == "" {
				t.Error("metadata.name is empty")
			}
			if server.Metadata.Visibility == "" {
				t.Error("metadata.visibility is empty")
			}
			if server.Spec.Description == "" {
				t.Error("spec.description is empty")
			}
			if len(server.Spec.Tags) == 0 && len(server.Metadata.Tags) == 0 {
				t.Error("spec.tags is empty (metadata.tags also empty)")
			}
			if server.Spec.Stdio == nil && server.Spec.HTTP == nil {
				t.Error("neither spec.stdio nor spec.http is set (exactly one required)")
			}
			if server.Spec.Stdio != nil && server.Spec.HTTP != nil {
				t.Error("both spec.stdio and spec.http are set (exactly one allowed)")
			}
			if server.Spec.Stdio != nil && server.Spec.Stdio.Command == "" {
				t.Error("spec.stdio.command is empty")
			}
			if server.Spec.HTTP != nil && server.Spec.HTTP.URL == "" {
				t.Error("spec.http.url is empty")
			}
		})
	}
}

func TestMcpServers_ValidCategory(t *testing.T) {
	servers := loadAllMcpServers(t)

	for name, server := range servers {
		t.Run(name, func(t *testing.T) {
			if isSystemServer(server) {
				t.Skip("system server uses stigmer.ai/system label instead of category")
			}
			category, ok := server.Metadata.Labels["stigmer.ai/category"]
			if !ok {
				t.Error("missing label stigmer.ai/category")
				return
			}
			if !validCategories[category] {
				t.Errorf("invalid category %q (not in allowed set)", category)
			}
		})
	}
}

func TestMcpServers_AuthConsistency(t *testing.T) {
	servers := loadAllMcpServers(t)

	for name, server := range servers {
		if server.Spec.Auth == nil {
			continue
		}
		t.Run(name, func(t *testing.T) {
			auth := server.Spec.Auth

			if auth.TargetEnvVar != "" {
				if _, exists := server.Spec.Env[auth.TargetEnvVar]; !exists {
					t.Errorf("auth.target_env_var %q is not declared in spec.env", auth.TargetEnvVar)
				}
			}

			if auth.OAuthAppRef != nil && auth.DiscoveryURL == "" {
				// vendor OAuth with oauth_app_ref can work with either transport
				// (the OAuthApp has its own endpoints)
			}

			if auth.OAuthAppRef == nil && auth.DiscoveryURL == "" && auth.TargetEnvVar != "" {
				// DCR OAuth without discovery_url requires HTTP transport
				// (discovery is derived from http.url)
				if server.Spec.HTTP == nil {
					t.Error("DCR OAuth (no oauth_app_ref, no discovery_url) requires HTTP transport for .well-known discovery")
				}
			}
		})
	}
}

func TestMcpServers_PlaceholderSyntax(t *testing.T) {
	servers := loadAllMcpServers(t)

	for name, server := range servers {
		t.Run(name, func(t *testing.T) {
			declaredVars := make(map[string]bool)
			for k := range server.Spec.Env {
				declaredVars[k] = true
			}

			checkPlaceholders := func(context, value string) {
				matches := placeholderRegex.FindAllStringSubmatch(value, -1)
				for _, match := range matches {
					varName := match[1]
					if !declaredVars[varName] {
						t.Errorf("%s: placeholder ${%s} references undeclared env var", context, varName)
					}
				}
			}

			if server.Spec.HTTP != nil {
				for headerName, headerValue := range server.Spec.HTTP.Headers {
					checkPlaceholders(fmt.Sprintf("http.headers[%s]", headerName), headerValue)
				}
				for paramName, paramValue := range server.Spec.HTTP.QueryParams {
					checkPlaceholders(fmt.Sprintf("http.query_params[%s]", paramName), paramValue)
				}
			}

			if server.Spec.Stdio != nil {
				for i, arg := range server.Spec.Stdio.Args {
					checkPlaceholders(fmt.Sprintf("stdio.args[%d]", i), arg)
				}
			}
		})
	}
}

func TestMcpServers_NoDuplicateNames(t *testing.T) {
	servers := loadAllMcpServers(t)
	seen := make(map[string]string) // metadata.name -> filename

	for filename, server := range servers {
		metaName := server.Metadata.Name
		if metaName == "" {
			continue
		}
		if existingFile, exists := seen[metaName]; exists {
			t.Errorf("duplicate metadata.name %q: found in both %s and %s", metaName, existingFile, filename)
		}
		seen[metaName] = filename
	}
}

func TestMcpServers_CredentialManifestComplete(t *testing.T) {
	servers := loadAllMcpServers(t)

	// The canary manifest is CI-tracking metadata, not a deployable resource, so
	// it lives in canary/ (outside the embedded content set) and is read from
	// disk rather than the embed FS. See seedpack/canary/credential-manifest.yaml.
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to determine test file path via runtime.Caller")
	}
	manifestPath := filepath.Join(filepath.Dir(thisFile), "canary", "credential-manifest.yaml")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("failed to read %s: %v", manifestPath, err)
	}

	var manifest struct {
		Servers map[string]interface{} `yaml:"servers"`
	}
	if err := yaml.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatalf("failed to parse credential-manifest.yaml: %v", err)
	}

	for filename := range servers {
		if _, exists := manifest.Servers[filename]; !exists {
			t.Errorf("server %q exists in mcp-servers/ but has no entry in credential-manifest.yaml", filename)
		}
	}

	for manifestName := range manifest.Servers {
		if _, exists := servers[manifestName]; !exists {
			t.Errorf("credential-manifest.yaml has entry %q but no matching .yaml file in mcp-servers/", manifestName)
		}
	}
}

func TestMcpServers_OAuthEndpointAudit(t *testing.T) {
	servers := loadAllMcpServers(t)
	hostedMcpPattern := regexp.MustCompile(`^https://mcp\.[^/]+\.(com|io|dev)/`)

	for name, server := range servers {
		if server.Spec.HTTP == nil {
			continue
		}
		if !hostedMcpPattern.MatchString(server.Spec.HTTP.URL) {
			continue
		}

		t.Run(name, func(t *testing.T) {
			if server.Spec.Auth == nil {
				t.Logf("WARNING: %s points to hosted MCP endpoint %s but has no auth block — likely needs OAuth",
					name, server.Spec.HTTP.URL)
			} else if server.Spec.Auth.OAuthAppRef == nil {
				// Has auth but no oauth_app_ref — relies on DCR.
				// This is fine if the provider supports it, but many don't.
				t.Logf("INFO: %s uses DCR OAuth against %s (no vendor OAuth app configured)",
					name, server.Spec.HTTP.URL)
			}
		})
	}
}

package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// NewValidateCommand creates the unified validate command.
func NewValidateCommand() *cobra.Command {
	var filePath string

	cmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate resource YAML files",
		Long: `Validate resource YAML files without applying them.

Checks that the file contains valid YAML with correct schema.
Supports Agent, Workflow, McpServer, and Project resources.

The resource type is auto-detected from the 'kind' field in the YAML.
Supports single files, directories, and multi-document YAML.`,
		Example: `  # Validate a single file
  stigmer validate -f agent.yaml
  stigmer validate -f workflow.yaml

  # Validate all YAML files in a directory
  stigmer validate -f ./manifests/

  # Validate a project configuration
  stigmer validate -f stigmer.yaml`,
		Run: func(cmd *cobra.Command, args []string) {
			if filePath == "" {
				clierr.Handle(errors.New("file path is required: use -f <file>"))
				return
			}

			err := executeValidate(validateOptions{
				FilePath: filePath,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&filePath, "file", "f", "", "path to YAML file or directory (required)")
	_ = cmd.MarkFlagRequired("file")

	return cmd
}

// validateOptions contains options for the validate command.
type validateOptions struct {
	FilePath string
}

// executeValidate validates resources from a file or directory.
func executeValidate(opts validateOptions) error {
	files, err := resolveValidateFiles(opts.FilePath)
	if err != nil {
		return err
	}

	if len(files) == 0 {
		return errors.New("no YAML files found")
	}

	validCount := 0
	for _, file := range files {
		count, err := validateFile(file)
		if err != nil {
			return err
		}
		validCount += count
	}

	fmt.Println()
	climsg.Success("Validation complete: %d resource(s) valid", validCount)
	fmt.Println()
	return nil
}

// resolveValidateFiles resolves the file path to a list of YAML files.
func resolveValidateFiles(path string) ([]string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, errors.Wrapf(err, "cannot access %s", path)
	}

	if !info.IsDir() {
		return []string{path}, nil
	}

	var files []string
	err = filepath.Walk(path, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if fi.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if ext == ".yaml" || ext == ".yml" {
			files = append(files, p)
		}
		return nil
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to scan directory %s", path)
	}

	return files, nil
}

// validateFile validates all resources in a single file.
func validateFile(filePath string) (int, error) {
	results, err := types.DetectMulti(filePath)
	if err != nil {
		return 0, errors.Wrapf(err, "failed to detect kinds in %s", filePath)
	}

	reg := types.DefaultRegistry()
	validCount := 0

	for _, result := range results {
		info, ok := reg.GetByYAMLKind(result.Kind)
		if !ok {
			return 0, fmt.Errorf("unknown resource kind '%s' in %s", result.Kind, filePath)
		}

		if !info.SupportsVerb(types.VerbValidate) {
			return 0, formatUnsupportedVerbError(info, types.VerbValidate)
		}

		if err := validateResource(info, result.RawContent, filePath); err != nil {
			return 0, err
		}

		climsg.Success("%s: %s is valid", filePath, info.DisplayName)
		validCount++
	}

	return validCount, nil
}

// validateResource validates a single resource based on its kind.
func validateResource(info *types.TypeInfo, content []byte, filePath string) error {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return validateAgent(content, filePath)

	case apiresourcekind.ApiResourceKind_workflow:
		return validateWorkflow(content, filePath)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return validateMcpServer(content, filePath)

	case apiresourcekind.ApiResourceKind_project:
		return validateProject(content, filePath)

	default:
		return fmt.Errorf("validation not implemented for %s", info.DisplayName)
	}
}

// validateAgent validates an agent resource.
func validateAgent(content []byte, filePath string) error {
	loadResult, err := agent.LoadFromBytes(content)
	if err != nil {
		return errors.Wrapf(err, "failed to load agent from %s", filePath)
	}

	if err := agent.Validate(loadResult.Agent); err != nil {
		return errors.Wrapf(err, "agent validation failed in %s", filePath)
	}

	return nil
}

// validateWorkflow validates a workflow resource.
func validateWorkflow(content []byte, filePath string) error {
	loadResult, err := workflow.LoadFromBytes(content)
	if err != nil {
		return errors.Wrapf(err, "failed to load workflow from %s", filePath)
	}

	if err := workflow.Validate(loadResult.Workflow); err != nil {
		return errors.Wrapf(err, "workflow validation failed in %s", filePath)
	}

	return nil
}

// validateMcpServer validates an MCP server resource.
func validateMcpServer(content []byte, filePath string) error {
	_, err := mcpserver.LoadFromBytes(content)
	if err != nil {
		return errors.Wrapf(err, "failed to validate MCP server from %s", filePath)
	}
	return nil
}

// validateProject validates a project resource.
func validateProject(content []byte, filePath string) error {
	_, err := project.LoadFromBytes(content)
	if err != nil {
		return errors.Wrapf(err, "failed to validate project from %s", filePath)
	}
	return nil
}

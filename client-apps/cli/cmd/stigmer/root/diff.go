package root

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/fatih/color"
	"github.com/pkg/errors"
	"github.com/pmezard/go-difflib/difflib"
	"github.com/spf13/cobra"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// NewDiffCommand creates the diff command for comparing local YAML with remote state.
func NewDiffCommand() *cobra.Command {
	var filePath string
	var contextLines int

	cmd := &cobra.Command{
		Use:   "diff",
		Short: "Compare local YAML with remote resource state",
		Long: `Compare local YAML resource files with their remote server state.

Auto-detects the resource kind from the YAML 'kind' field.
Shows a unified diff of what would change if you run 'stigmer apply -f'.

Supports Agent, Workflow, and McpServer resources.`,
		Example: `  # Diff a workflow
  stigmer diff -f workflow.yaml

  # Diff an agent
  stigmer diff -f agent.yaml

  # Diff all YAML files in a directory
  stigmer diff -f ./manifests/

  # Show more context lines
  stigmer diff -f workflow.yaml --context 5`,
		Run: func(cmd *cobra.Command, args []string) {
			if filePath == "" {
				clierr.Handle(errors.New("file path is required: use -f <file>"))
				return
			}
			clierr.Handle(executeDiff(diffOptions{
				FilePath:     filePath,
				ContextLines: contextLines,
			}))
		},
	}

	cmd.Flags().StringVarP(&filePath, "file", "f", "", "path to YAML file or directory (required)")
	cmd.Flags().IntVar(&contextLines, "context", 3, "number of context lines in diff output")
	_ = cmd.MarkFlagRequired("file")

	return cmd
}

type diffOptions struct {
	FilePath     string
	ContextLines int
}

func executeDiff(opts diffOptions) error {
	files, err := resolveDiffFiles(opts.FilePath)
	if err != nil {
		return err
	}

	if len(files) == 0 {
		return errors.New("no YAML files found")
	}

	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveOrganization(cfg, "")
	if err != nil {
		return err
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return errors.Wrap(err, "failed to start daemon")
		}
	}

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()

	hasDiffs := false
	for _, file := range files {
		diffFound, err := diffFile(file, orgID, opts.ContextLines, client)
		if err != nil {
			return err
		}
		if diffFound {
			hasDiffs = true
		}
	}

	if !hasDiffs {
		climsg.Success("No differences found")
	}

	return nil
}

func diffFile(filePath, orgID string, contextLines int, client *stigmer.Client) (bool, error) {
	results, err := types.DetectMulti(filePath)
	if err != nil {
		return false, errors.Wrapf(err, "failed to detect kinds in %s", filePath)
	}

	hasDiffs := false
	reg := types.DefaultRegistry()

	for _, result := range results {
		info, ok := reg.GetByYAMLKind(result.Kind)
		if !ok {
			return false, fmt.Errorf("unknown resource kind '%s' in %s", result.Kind, filePath)
		}

		diffFound, err := diffResource(info, result.RawContent, filePath, orgID, contextLines, client)
		if err != nil {
			return false, err
		}
		if diffFound {
			hasDiffs = true
		}
	}

	return hasDiffs, nil
}

func diffResource(info *types.TypeInfo, localContent []byte, filePath, orgID string, contextLines int, client *stigmer.Client) (bool, error) {
	remote, err := fetchRemoteResource(info, localContent, orgID, client)
	if err != nil {
		fmt.Printf("--- %s (new resource, not yet deployed)\n", filePath)
		fmt.Println(color.GreenString("+ entire file is new"))
		fmt.Println()
		return true, nil
	}

	remoteYAML, err := renderResourceYAML(remote)
	if err != nil {
		return false, errors.Wrap(err, "failed to serialize remote resource to YAML")
	}

	localYAML := string(localContent)

	if strings.TrimSpace(localYAML) == strings.TrimSpace(remoteYAML) {
		return false, nil
	}

	diff := difflib.UnifiedDiff{
		A:        difflib.SplitLines(remoteYAML),
		B:        difflib.SplitLines(localYAML),
		FromFile: fmt.Sprintf("remote/%s", filepath.Base(filePath)),
		ToFile:   fmt.Sprintf("local/%s", filepath.Base(filePath)),
		Context:  contextLines,
	}

	text, err := difflib.GetUnifiedDiffString(diff)
	if err != nil {
		return false, errors.Wrap(err, "failed to compute diff")
	}

	if text == "" {
		return false, nil
	}

	printColoredDiff(text)
	return true, nil
}

func fetchRemoteResource(info *types.TypeInfo, localContent []byte, orgID string, client *stigmer.Client) (proto.Message, error) {
	switch info.ProtoKind {
	case apiresourcekind.ApiResourceKind_workflow:
		return fetchRemoteWorkflow(localContent, orgID, client)
	default:
		return nil, fmt.Errorf("diff not yet supported for %s", info.DisplayName)
	}
}

func fetchRemoteWorkflow(localContent []byte, orgID string, client *stigmer.Client) (proto.Message, error) {
	loadResult, err := workflow.LoadFromBytes(localContent)
	if err != nil {
		return nil, errors.Wrap(err, "failed to parse local workflow")
	}

	slug := loadResult.Workflow.GetMetadata().GetSlug()
	if slug == "" {
		slug = loadResult.Workflow.GetMetadata().GetName()
	}
	if slug == "" {
		return nil, errors.New("workflow has no slug or name for remote lookup")
	}

	ctx := context.Background()
	remote, err := client.Workflow.GetByReference(ctx, stigmer.ResourceRef{
		Org:  orgID,
		Slug: slug,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to fetch remote workflow '%s'", slug)
	}

	return remote, nil
}

func renderResourceYAML(msg proto.Message) (string, error) {
	var buf bytes.Buffer
	if err := display.RenderProtoYAML(&buf, msg); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func printColoredDiff(text string) {
	for _, line := range strings.Split(text, "\n") {
		switch {
		case strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---"):
			fmt.Println(color.New(color.Bold).Sprint(line))
		case strings.HasPrefix(line, "@@"):
			fmt.Println(color.CyanString(line))
		case strings.HasPrefix(line, "+"):
			fmt.Println(color.GreenString(line))
		case strings.HasPrefix(line, "-"):
			fmt.Println(color.RedString(line))
		default:
			fmt.Println(line)
		}
	}
}

func resolveDiffFiles(path string) ([]string, error) {
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

package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"google.golang.org/grpc"
)

// fileApplyOptions contains options for file-based apply.
type fileApplyOptions struct {
	FilePath    string
	OrgOverride string
	DryRun      bool
}

// executeFileApply applies resources from a file or directory.
func executeFileApply(opts fileApplyOptions) error {
	// Step 1: Resolve file path(s)
	files, err := resolveApplyFiles(opts.FilePath)
	if err != nil {
		return err
	}

	if len(files) == 0 {
		return errors.New("no YAML files found")
	}

	// Step 2: Detect kinds from all files
	var applyItems []applyItem
	for _, file := range files {
		items, err := detectApplyItems(file)
		if err != nil {
			return err
		}
		applyItems = append(applyItems, items...)
	}

	if len(applyItems) == 0 {
		return errors.New("no valid resources found in files")
	}

	// Step 3: Setup backend connection (unless dry-run)
	var conn grpc.ClientConnInterface
	var orgID string

	if !opts.DryRun {
		cfg, err := config.Load()
		if err != nil {
			return errors.Wrap(err, "failed to load configuration")
		}

		orgID, err = resolveOrganization(cfg, opts.OrgOverride)
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

		cliprint.PrintInfo("Connecting to backend...")
		conn, err = backend.NewConnection()
		if err != nil {
			return errors.Wrap(err, "failed to connect to backend")
		}
		defer conn.(*grpc.ClientConn).Close()
		cliprint.PrintSuccess("Connected to backend")
		fmt.Println()
	}

	// Step 4: Apply each item
	for _, item := range applyItems {
		if err := applyResourceItem(item, conn, orgID, opts.DryRun); err != nil {
			return err
		}
	}

	return nil
}

// applyItem represents a resource to apply.
type applyItem struct {
	filePath   string
	kind       string
	typeInfo   *types.TypeInfo
	rawContent []byte
}

// resolveApplyFiles resolves the file path to a list of YAML files.
func resolveApplyFiles(path string) ([]string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, errors.Wrapf(err, "cannot access %s", path)
	}

	if !info.IsDir() {
		return []string{path}, nil
	}

	// Directory: collect all YAML files
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

// detectApplyItems detects resource kinds from a file.
func detectApplyItems(filePath string) ([]applyItem, error) {
	results, err := types.DetectMulti(filePath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to detect kinds in %s", filePath)
	}

	reg := types.DefaultRegistry()
	var items []applyItem

	for _, result := range results {
		info, ok := reg.GetByYAMLKind(result.Kind)
		if !ok {
			return nil, fmt.Errorf("unknown resource kind '%s' in %s", result.Kind, filePath)
		}

		if !info.SupportsVerb(types.VerbApply) {
			return nil, formatUnsupportedVerbError(info, types.VerbApply)
		}

		items = append(items, applyItem{
			filePath:   filePath,
			kind:       result.Kind,
			typeInfo:   info,
			rawContent: result.RawContent,
		})
	}

	return items, nil
}

// applyResourceItem applies a single resource item.
func applyResourceItem(item applyItem, conn grpc.ClientConnInterface, orgID string, dryRun bool) error {
	cliprint.PrintInfo("Applying %s from %s...", item.typeInfo.DisplayName, item.filePath)

	switch item.typeInfo.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return applyAgent(item, conn, orgID, dryRun)

	case apiresourcekind.ApiResourceKind_workflow:
		return applyWorkflow(item, conn, orgID, dryRun)

	case apiresourcekind.ApiResourceKind_mcp_server:
		return applyMcpServer(item, conn, orgID, dryRun)

	default:
		return fmt.Errorf("apply not implemented for %s", item.typeInfo.DisplayName)
	}
}

// applyAgent applies an agent from raw content.
func applyAgent(item applyItem, conn grpc.ClientConnInterface, orgID string, dryRun bool) error {
	loadResult, err := agent.LoadFromBytes(item.rawContent)
	if err != nil {
		return errors.Wrap(err, "failed to load agent")
	}

	if err := agent.Validate(loadResult.Agent); err != nil {
		return errors.Wrap(err, "agent validation failed")
	}

	if dryRun {
		cliprint.PrintSuccess("Dry run: %s is valid", loadResult.Agent.Metadata.Name)
		agent.DisplayAgentPreview(loadResult.Agent)
		return nil
	}

	result, err := agent.Apply(&agent.ApplyOptions{
		Agent:  loadResult.Agent,
		OrgID:  orgID,
		Conn:   conn,
		Quiet:  false,
		DryRun: false,
	})
	if err != nil {
		return err
	}

	agent.DisplayApplyResult(result)
	return nil
}

// applyWorkflow applies a workflow from raw content.
func applyWorkflow(item applyItem, conn grpc.ClientConnInterface, orgID string, dryRun bool) error {
	loadResult, err := workflow.LoadFromBytes(item.rawContent)
	if err != nil {
		return errors.Wrap(err, "failed to load workflow")
	}

	if err := workflow.Validate(loadResult.Workflow); err != nil {
		return errors.Wrap(err, "workflow validation failed")
	}

	if dryRun {
		cliprint.PrintSuccess("Dry run: %s is valid", loadResult.Workflow.Metadata.Name)
		workflow.DisplayWorkflowPreview(loadResult.Workflow)
		return nil
	}

	result, err := workflow.Apply(&workflow.ApplyOptions{
		Workflow: loadResult.Workflow,
		OrgID:    orgID,
		Conn:     conn,
		Quiet:    false,
		DryRun:   false,
	})
	if err != nil {
		return err
	}

	workflow.DisplayApplyResult(result)
	return nil
}

// applyMcpServer applies an MCP server from raw content.
func applyMcpServer(item applyItem, conn grpc.ClientConnInterface, orgID string, dryRun bool) error {
	loadResult, err := mcpserver.LoadFromBytes(item.rawContent)
	if err != nil {
		return errors.Wrap(err, "failed to load MCP server")
	}

	if dryRun {
		cliprint.PrintSuccess("Dry run: %s is valid", loadResult.McpServer.Metadata.Name)
		mcpserver.DisplayMcpServerPreview(loadResult.McpServer)
		return nil
	}

	result, err := mcpserver.Apply(&mcpserver.ApplyOptions{
		McpServer: loadResult.McpServer,
		OrgID:     orgID,
		Conn:      conn,
		Quiet:     false,
		DryRun:    false,
	})
	if err != nil {
		return err
	}

	mcpserver.DisplayApplyResult(result)
	return nil
}

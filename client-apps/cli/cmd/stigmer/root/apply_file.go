package root

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

type fileApplyOptions struct {
	FilePath     string
	OrgOverride  string
	DryRun       bool
	OutputFormat clioutput.OutputFormat
}

// fileApplyContext bundles dependencies for per-resource apply handlers.
type fileApplyContext struct {
	conn     grpc.ClientConnInterface
	orgID    string
	dryRun   bool
	renderer clioutput.Renderer
	cfg      *config.Config

	// appliedMcpServers collects MCP server protos that were successfully
	// applied, so post-apply discovery can be triggered for each one.
	appliedMcpServers []*mcpserverv1.McpServer
}

func executeFileApply(opts fileApplyOptions) error {
	renderer := clioutput.NewRenderer(opts.OutputFormat, os.Stdout, os.Stderr)

	files, err := resolveApplyFiles(opts.FilePath)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return errors.New("no YAML files found")
	}

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

	fctx := &fileApplyContext{
		dryRun:   opts.DryRun,
		renderer: renderer,
	}

	if !opts.DryRun {
		cfg, err := config.Load()
		if err != nil {
			return errors.Wrap(err, "failed to load configuration")
		}
		fctx.cfg = cfg

		// Organization resources are self-identifying (slug-based lookup on
		// the server) and sit above Project in the hierarchy. They don't
		// require an org context to be applied. Only resolve org when at
		// least one non-Organization resource is present.
		if requiresOrgContext(applyItems) {
			fctx.orgID, err = resolveOrganization(cfg, opts.OrgOverride)
			if err != nil {
				return err
			}
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

		fmt.Fprintf(os.Stderr, "Connecting to backend...\n")
		conn, err := backend.NewConnection()
		if err != nil {
			return errors.Wrap(err, "failed to connect to backend")
		}
		defer conn.Close()
		fctx.conn = conn
		fmt.Fprintf(os.Stderr, "Connected to backend\n\n")
	}

	for _, item := range applyItems {
		if _, err := applyResourceItem(item, fctx); err != nil {
			return err
		}
	}

	if !opts.DryRun {
		discoverAppliedMcpServers(fctx)
	}

	return nil
}

type applyItem struct {
	filePath   string
	kind       string
	typeInfo   *types.TypeInfo
	rawContent []byte
}

func resolveApplyFiles(path string) ([]string, error) {
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

// applyResourceItem applies a single resource item and returns a reference to the
// applied resource. Returns (nil, nil) for dry-run mode.
func applyResourceItem(item applyItem, fctx *fileApplyContext) (*apiresource.ApiResourceReference, error) {
	fmt.Fprintf(os.Stderr, "Applying %s from %s...\n", item.typeInfo.DisplayName, item.filePath)

	switch item.typeInfo.ProtoKind {
	case apiresourcekind.ApiResourceKind_organization:
		return applyOrganization(item, fctx)
	case apiresourcekind.ApiResourceKind_agent:
		return applyAgent(item, fctx)
	case apiresourcekind.ApiResourceKind_workflow:
		return applyWorkflow(item, fctx)
	case apiresourcekind.ApiResourceKind_mcp_server:
		return applyMcpServer(item, fctx)
	default:
		return nil, fmt.Errorf("apply not implemented for %s", item.typeInfo.DisplayName)
	}
}

// requiresOrgContext returns true when the item set contains at least one
// resource kind that needs an organization context to be applied. Organization
// resources are the sole exception: they are the root of the resource hierarchy
// and are identified by slug, not by a parent org.
func requiresOrgContext(items []applyItem) bool {
	for _, item := range items {
		if item.typeInfo.ProtoKind != apiresourcekind.ApiResourceKind_organization {
			return true
		}
	}
	return false
}

// discoverAppliedMcpServers triggers best-effort capability discovery for MCP
// servers that were successfully applied in this session. This makes tools
// available immediately without requiring a daemon restart.
func discoverAppliedMcpServers(fctx *fileApplyContext) {
	if len(fctx.appliedMcpServers) == 0 || fctx.cfg == nil {
		return
	}

	climsg.Info("Discovering capabilities for %d applied MCP server(s)...", len(fctx.appliedMcpServers))

	for _, server := range fctx.appliedMcpServers {
		skipMsg, err := mcpserver.DiscoverOne(context.Background(), &mcpserver.DiscoverOneOptions{
			Conn:    fctx.conn,
			Cfg:     fctx.cfg,
			Server:  server,
			Timeout: 30 * time.Second,
		})

		name := server.Metadata.GetName()

		if skipMsg != "" {
			climsg.Warning("%s", skipMsg)
			continue
		}
		if err != nil {
			climsg.Warning("Discovery failed for %s: %v", name, err)
			continue
		}
		climsg.Success("Discovered capabilities for %s", name)
	}
}

package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/grpc"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

type fileApplyOptions struct {
	FilePath    string
	OrgOverride string
	DryRun      bool
}

// fileApplyContext bundles dependencies for per-resource apply handlers.
type fileApplyContext struct {
	conn     grpc.ClientConnInterface
	orgID    string
	dryRun   bool
	renderer clioutput.Renderer
}

func executeFileApply(opts fileApplyOptions) error {
	renderer := clioutput.NewRenderer(clioutput.FormatHuman, os.Stdout, os.Stderr)

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

		fctx.orgID, err = resolveOrganization(cfg, opts.OrgOverride)
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
		if err := applyResourceItem(item, fctx); err != nil {
			return err
		}
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

func applyResourceItem(item applyItem, fctx *fileApplyContext) error {
	fmt.Fprintf(os.Stderr, "Applying %s from %s...\n", item.typeInfo.DisplayName, item.filePath)

	switch item.typeInfo.ProtoKind {
	case apiresourcekind.ApiResourceKind_agent:
		return applyAgent(item, fctx)
	case apiresourcekind.ApiResourceKind_workflow:
		return applyWorkflow(item, fctx)
	case apiresourcekind.ApiResourceKind_mcp_server:
		return applyMcpServer(item, fctx)
	default:
		return fmt.Errorf("apply not implemented for %s", item.typeInfo.DisplayName)
	}
}

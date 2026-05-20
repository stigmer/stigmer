package daemon

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/cursorrunner"
	cliconfig "github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/nodert"
)

// CursorRunnerBootstrapResult holds the output of cursor-runner bootstrap.
// EntryArgs contains the arguments for the cursor-runner entry point:
// dev mode returns tsx args; embed mode returns ["dist/main.js"].
type CursorRunnerBootstrapResult struct {
	NodeBin   string
	AppDir    string
	EntryArgs []string
}

// bootstrapCursorRunnerRuntime prepares the Node.js runtime and installs
// dependencies for the cursor-runner. Returns bootstrap result containing
// the node binary path, app directory, and entry point args.
//
// Two modes:
//   - Dev mode (SourceDir != ""): system Node.js + tsx, source from repo tree
//   - Embed mode (SourceFS != nil, SourceDir == ""): managed Node.js + compiled JS
func bootstrapCursorRunnerRuntime() (*CursorRunnerBootstrapResult, error) {
	if cursorrunner.SourceDir() != "" {
		return bootstrapCursorRunnerDevMode()
	}
	return bootstrapCursorRunnerEmbedMode()
}

func bootstrapCursorRunnerDevMode() (*CursorRunnerBootstrapResult, error) {
	appDir := cursorrunner.SourceDir()
	if _, err := os.Stat(filepath.Join(appDir, "package.json")); err != nil {
		return nil, errors.Wrapf(err, "cursor-runner package.json not found at %s", appDir)
	}

	nodeBin, err := nodert.EnsureNodeAvailable()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := nodert.EnsureDepsInstalled(ctx, appDir); err != nil {
		return nil, errors.Wrap(err, "failed to install cursor-runner dependencies")
	}

	tsxArgs, err := nodert.TsxArgs(appDir, filepath.Join("src", "main.ts"))
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve tsx entry point")
	}

	log.Info().
		Str("node", nodeBin).
		Str("app_dir", appDir).
		Msg("Cursor runner runtime bootstrapped (dev mode)")

	return &CursorRunnerBootstrapResult{
		NodeBin:   nodeBin,
		AppDir:    appDir,
		EntryArgs: tsxArgs,
	}, nil
}

func bootstrapCursorRunnerEmbedMode() (*CursorRunnerBootstrapResult, error) {
	sourceFS := cursorrunner.SourceFS()
	if sourceFS == nil {
		return nil, errors.New("cursor-runner source is not available. " +
			"If building from source, run sync.sh and build with -tags embed_cursorrunner")
	}

	configDir, err := cliconfig.GetConfigDir()
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve config directory")
	}

	mgr, err := nodert.NewManager(nodert.Config{
		BaseDir:     filepath.Join(configDir, "runtimes", "cursor-runner"),
		CLIVersion:  embedded.GetBuildVersion(),
		AppSourceFS: sourceFS,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Node.js runtime manager")
	}

	log.Info().
		Str("runtime_dir", mgr.RuntimeDir()).
		Msg("Bootstrapping Node.js runtime for cursor-runner")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if err := mgr.EnsureReady(ctx); err != nil {
		return nil, errors.Wrap(err, "failed to bootstrap Node.js runtime")
	}

	return &CursorRunnerBootstrapResult{
		NodeBin:   mgr.NodeBin(),
		AppDir:    mgr.AppDir(),
		EntryArgs: []string{filepath.Join("dist", "main.js")},
	}, nil
}

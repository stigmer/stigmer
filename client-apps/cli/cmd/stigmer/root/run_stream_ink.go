package root

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// inkPackageVersion is the @stigmer/ink npm package version used by the CLI.
// Updated alongside CLI releases — both are derived from the same git tag.
const inkPackageVersion = "0.0.0-dev"

// inkConfig holds the information needed to spawn the Ink renderer process.
type inkConfig struct {
	SessionID string
	OrgID     string
	BaseURL   string
	Token     string
}

// resolveInkConfig extracts the API connection details needed by the Ink
// renderer from the CLI config. The Ink process establishes its own gRPC-web
// connection using these values.
func resolveInkConfig(sessionID, orgID string) (*inkConfig, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, errors.Wrap(err, "failed to load config for ink renderer")
	}

	ic := &inkConfig{
		SessionID: sessionID,
		OrgID:     orgID,
	}

	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		port := "7234"
		if testAddr := os.Getenv("STIGMER_SERVER_ADDR"); testAddr != "" {
			ic.BaseURL = "http://" + testAddr
		} else {
			ic.BaseURL = "http://localhost:" + port
		}

	case config.BackendTypeCloud:
		endpoint := "api.stigmer.ai:443"
		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.Endpoint != "" {
			endpoint = cfg.Backend.Cloud.Endpoint
		}
		ic.BaseURL = "https://" + endpoint

		if apiKey := os.Getenv("STIGMER_API_KEY"); apiKey != "" {
			ic.Token = apiKey
		} else if cfg.Backend.Cloud != nil {
			ic.Token = cfg.Backend.Cloud.Token
		}
		if ic.Token == "" {
			return nil, errors.New("cloud backend requires authentication — run 'stigmer auth login' or set STIGMER_API_KEY")
		}

	default:
		return nil, errors.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}

	return ic, nil
}

// resolveInkCommand builds an exec.Cmd for the Ink renderer using a three-tier
// resolution strategy that mirrors how the web app resolves @stigmer/react:
//
//  1. STIGMER_INK_CMD env var — escape hatch for custom setups.
//  2. Workspace detection — first from the binary location (bin/stigmer),
//     then by walking up from CWD to handle binaries installed outside
//     the repo (e.g. ~/bin, $GOPATH/bin, bazel-bin).
//  3. npx with pinned version — production path, downloads on first run.
func resolveInkCommand(args []string) (*exec.Cmd, error) {
	// 1. Escape hatch: explicit override.
	if override := os.Getenv("STIGMER_INK_CMD"); override != "" {
		parts := strings.Fields(override)
		return exec.Command(parts[0], append(parts[1:], args...)...), nil
	}

	// 2a. Workspace detection from binary location (development).
	// When the CLI is built with `make build` the binary lands at
	// <workspace>/bin/stigmer. We look for tsx and the source entry point
	// relative to the binary location.
	if exePath, err := os.Executable(); err == nil {
		binDir := filepath.Dir(exePath)
		workspaceRoot := filepath.Join(binDir, "..")

		if cmd, ok := tryWorkspaceInk(workspaceRoot, args); ok {
			return cmd, nil
		}
	}

	// 2b. Workspace detection from CWD — handles binaries installed
	// outside the repo (~/bin, $GOPATH/bin, bazel output, etc.).
	if cwd, err := os.Getwd(); err == nil {
		if root := findWorkspaceRoot(cwd); root != "" {
			if cmd, ok := tryWorkspaceInk(root, args); ok {
				return cmd, nil
			}
		}
	}

	// 3. Production: npx with pinned version.
	npxPath, err := exec.LookPath("npx")
	if err != nil {
		return nil, fmt.Errorf(
			"interactive session rendering requires Node.js >= 18\n" +
				"Install from https://nodejs.org, or use --json for machine-readable output")
	}

	npxArgs := append([]string{"--yes", "@stigmer/ink@" + inkPackageVersion}, args...)
	return exec.Command(npxPath, npxArgs...), nil
}

// tryWorkspaceInk checks whether root looks like the stigmer monorepo
// workspace and returns a tsx command for the Ink entry point if so.
func tryWorkspaceInk(root string, args []string) (*exec.Cmd, bool) {
	tsxBin := filepath.Join(root, "node_modules", ".bin", "tsx")
	inkEntry := filepath.Join(root, "sdk", "ink", "src", "cli", "stigmer-ink.tsx")

	if fileExists(tsxBin) && fileExists(inkEntry) {
		return exec.Command(tsxBin, append([]string{inkEntry}, args...)...), true
	}
	return nil, false
}

// findWorkspaceRoot walks up from dir looking for the stigmer monorepo root
// (identified by the presence of both node_modules/.bin/tsx and the Ink source
// entry point).
func findWorkspaceRoot(dir string) string {
	for {
		tsxBin := filepath.Join(dir, "node_modules", ".bin", "tsx")
		inkEntry := filepath.Join(dir, "sdk", "ink", "src", "cli", "stigmer-ink.tsx")
		if fileExists(tsxBin) && fileExists(inkEntry) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// streamAgentInk spawns the @stigmer/ink renderer as an external process,
// passing it full control of the terminal. The Ink process connects to the
// Stigmer API independently and handles streaming, approvals, and follow-up.
//
// After the Ink process exits, Go queries the final execution status to
// determine the CLI exit code.
func streamAgentInk(sessionID string, headerInfo sessionHeaderInfo, executionID, orgID string, client *stigmer.Client) (*agentexecutionv1.AgentExecution, error) {
	ic, err := resolveInkConfig(sessionID, orgID)
	if err != nil {
		return nil, err
	}

	inkArgs := []string{
		"--session", ic.SessionID,
		"--org", ic.OrgID,
		"--base-url", ic.BaseURL,
	}
	if ic.Token != "" {
		inkArgs = append(inkArgs, "--api-key", ic.Token)
	}

	cmd, err := resolveInkCommand(inkArgs)
	if err != nil {
		return nil, err
	}

	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	renderSessionHeader(os.Stderr, headerInfo)

	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() != 0 {
			// Non-zero exit from Ink — fetch final state to determine cause.
		} else {
			return nil, errors.Wrap(err, "ink renderer failed")
		}
	}

	return streamAgentEpilogue(sessionID, executionID, "", "", client)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

package pythonrt

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// createVenv creates a Python virtual environment at venvDir using the
// python-build-standalone interpreter at pythonBin.
func createVenv(ctx context.Context, pythonBin, venvDir string) error {
	cmd := exec.CommandContext(ctx, pythonBin, "-m", "venv", venvDir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return errors.Wrapf(err, "python -m venv failed: %s", trimOutput(output))
	}
	log.Debug().Str("venv", venvDir).Msg("Virtual environment created")
	return nil
}

// installDependencies installs packages into the venv. If wheelDir is
// non-empty, packages are installed offline from the wheelhouse. Otherwise,
// pip fetches packages from the network using the requirements file.
func installDependencies(ctx context.Context, venvPython, depsSource, wheelDir string) error {
	args := []string{"-m", "pip", "install", "--no-cache-dir"}
	if wheelDir != "" {
		args = append(args, "--no-index", "--find-links", wheelDir)
	}
	args = append(args, "-r", depsSource)

	cmd := exec.CommandContext(ctx, venvPython, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return errors.Wrapf(err, "pip install failed: %s", trimOutput(output))
	}
	log.Debug().Str("source", depsSource).Msg("Dependencies installed")
	return nil
}

// runPostInstallCmds executes fixup commands inside the venv (e.g., the
// deepagents namespace collision workaround). Executable names like "pip" or
// "python" are resolved to the venv's bin directory.
func runPostInstallCmds(ctx context.Context, venvDir string, cmds [][]string) error {
	venvBin := filepath.Join(venvDir, "bin")
	for _, parts := range cmds {
		if len(parts) == 0 {
			continue
		}
		exe := resolveVenvExe(venvBin, parts[0])
		cmd := exec.CommandContext(ctx, exe, parts[1:]...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return errors.Wrapf(err, "post-install command %v failed: %s", parts, trimOutput(output))
		}
		log.Debug().Strs("cmd", parts).Msg("Post-install command completed")
	}
	return nil
}

// resolveVenvExe maps well-known Python executable names to their absolute
// paths inside the venv's bin directory.
func resolveVenvExe(venvBin, name string) string {
	switch name {
	case "pip", "pip3", "python", "python3":
		return filepath.Join(venvBin, name)
	default:
		return name
	}
}

// trimOutput returns the last maxLen characters of the output, prefixed with
// "..." when truncated. Used to keep error messages readable for long pip output.
func trimOutput(output []byte) string {
	s := strings.TrimSpace(string(output))
	const maxLen = 500
	if len(s) > maxLen {
		return "..." + s[len(s)-maxLen:]
	}
	return s
}

package seedpackbootstrap

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
)

// applyOrganizations runs Phase 1: apply organization resources.
//
// Organizations are the root of the resource hierarchy and must exist before
// project members reference them.
func applyOrganizations(cliBin, seedpackDir string, verbose bool) error {
	orgDir := filepath.Join(seedpackDir, "organizations")
	info, err := os.Stat(orgDir)
	if err != nil || !info.IsDir() {
		return nil
	}

	return runApply(cliBin, []string{"apply", "-f", orgDir}, verbose)
}

// applyProject runs Phase 2: apply the seedpack project (agents, skills,
// MCP servers) under the target organization.
//
// The --org flag overrides stigmer.yaml's metadata.org, allowing the seedpack
// org to be controlled externally without modifying the embedded YAML.
func applyProject(cliBin, seedpackDir, org string, verbose bool) error {
	return runApply(cliBin, []string{"apply", "--config", seedpackDir, "--org", org, "--public-skills"}, verbose)
}

// runApply executes `stigmer apply` as a subprocess with the recursion guard
// environment variable set to prevent infinite loops.
func runApply(cliBin string, args []string, verbose bool) error {
	cmd := exec.Command(cliBin, args...)
	cmd.Env = append(os.Environ(), recursionGuardEnvVar+"=1")

	var buf bytes.Buffer
	if verbose {
		cmd.Stdout = os.Stderr
		cmd.Stderr = os.Stderr
	} else {
		cmd.Stdout = &buf
		cmd.Stderr = &buf
	}

	if err := cmd.Run(); err != nil {
		if !verbose {
			os.Stderr.Write(buf.Bytes())
		}
		return errors.Wrapf(err, "failed to run: stigmer %s", strings.Join(args, " "))
	}

	return nil
}

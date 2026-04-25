//go:build !windows

package daemon

import (
	"os/exec"
	"syscall"
)

// setProcGroup places cmd in its own process group so that signals
// delivered to the daemon do not inadvertently reach child processes.
func setProcGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

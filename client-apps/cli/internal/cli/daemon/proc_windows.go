//go:build windows

package daemon

import (
	"os/exec"
	"syscall"
)

// setProcGroup places cmd in a new process group on Windows.
func setProcGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

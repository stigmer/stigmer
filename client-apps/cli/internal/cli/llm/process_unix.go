//go:build !windows

package llm

import "syscall"

// getSysProcAttr returns platform-specific process attributes
// On Unix, we want the process to survive parent exit
func getSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true, // Create new process group
		Pgid:    0,
	}
}

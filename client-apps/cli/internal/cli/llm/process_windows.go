//go:build windows

package llm

import "syscall"

// getSysProcAttr returns platform-specific process attributes
// On Windows, detach from parent console
func getSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008, // DETACHED_PROCESS
	}
}

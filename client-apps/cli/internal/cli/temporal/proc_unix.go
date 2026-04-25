//go:build !windows

package temporal

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// setProcGroup configures cmd to run in its own process group so that
// killGroup can later signal the entire tree.
func setProcGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killGroup sends sig to the entire process group rooted at pid.
func killGroup(pid int, sig syscall.Signal) error {
	return syscall.Kill(-pid, sig)
}

// sigTERM is the graceful-shutdown signal.
const sigTERM = syscall.SIGTERM

// sigKILL is the forced-kill signal.
const sigKILL = syscall.SIGKILL

// processAlive returns nil when the process is still running.
func processAlive(pid int) error {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return proc.Signal(syscall.Signal(0))
}

// flockAcquire takes an exclusive, non-blocking file lock.
func flockAcquire(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

// flockRelease releases a previously acquired file lock.
func flockRelease(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}

// isLockBusy reports whether err means another process holds the lock.
func isLockBusy(err error) bool {
	return err == syscall.EWOULDBLOCK
}

// processCommandName returns the short command name for pid (via ps).
func processCommandName(pid int) (string, error) {
	cmd := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "comm=")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// processFullCommand returns the full command line for pid (via ps).
func processFullCommand(pid int) (string, error) {
	cmd := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "command=")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// findListeningPID returns the PID listening on the given TCP port, or 0.
func findListeningPID(port int) int {
	cmd := exec.Command("lsof", "-ti", fmt.Sprintf("tcp:%d", port), "-sTCP:LISTEN")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	pidStr := strings.TrimSpace(string(output))
	if pidStr == "" {
		return 0
	}

	if idx := strings.IndexByte(pidStr, '\n'); idx > 0 {
		pidStr = pidStr[:idx]
	}

	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return 0
	}
	return pid
}

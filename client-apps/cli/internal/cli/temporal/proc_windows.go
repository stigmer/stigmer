//go:build windows

package temporal

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// setProcGroup configures cmd to start in a new process group on Windows.
func setProcGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

// killGroup terminates the process tree rooted at pid.
// The sig parameter is accepted for API compatibility but ignored on Windows;
// taskkill /F always force-terminates.
func killGroup(pid int, _ syscall.Signal) error {
	return exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid)).Run()
}

// sigTERM is mapped to the value used by killGroup; on Windows both
// graceful and forced shutdown go through taskkill /F.
const sigTERM = syscall.Signal(0xf)

const sigKILL = syscall.Signal(0x9)

// processAlive returns nil when the process is still running.
func processAlive(pid int) error {
	cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH")
	output, err := cmd.Output()
	if err != nil {
		return err
	}
	if !strings.Contains(string(output), strconv.Itoa(pid)) {
		return fmt.Errorf("process %d not found", pid)
	}
	return nil
}

// flockAcquire takes an exclusive lock using Windows LockFileEx.
func flockAcquire(f *os.File) error {
	return lockFileWindows(f)
}

// flockRelease releases a Windows file lock.
func flockRelease(f *os.File) error {
	return unlockFileWindows(f)
}

// isLockBusy reports whether err means another process holds the lock.
func isLockBusy(err error) bool {
	return err != nil
}

// processCommandName returns the image name for pid (via tasklist).
func processCommandName(pid int) (string, error) {
	cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	line := strings.TrimSpace(string(output))
	if line == "" || strings.Contains(line, "No tasks") {
		return "", fmt.Errorf("process %d not found", pid)
	}
	parts := strings.SplitN(line, ",", 3)
	if len(parts) < 1 {
		return "", fmt.Errorf("unexpected tasklist output")
	}
	return strings.Trim(parts[0], "\""), nil
}

// processFullCommand is a best-effort implementation on Windows.
// WMIC is deprecated but broadly available; falls back to tasklist.
func processFullCommand(pid int) (string, error) {
	cmd := exec.Command("wmic", "process", "where", fmt.Sprintf("ProcessId=%d", pid), "get", "CommandLine", "/format:list")
	output, err := cmd.Output()
	if err != nil {
		return processCommandName(pid)
	}
	for _, line := range strings.Split(string(output), "\n") {
		if strings.HasPrefix(line, "CommandLine=") {
			return strings.TrimSpace(strings.TrimPrefix(line, "CommandLine=")), nil
		}
	}
	return processCommandName(pid)
}

// findListeningPID returns the PID listening on the given TCP port, or 0.
func findListeningPID(port int) int {
	cmd := exec.Command("netstat", "-ano", "-p", "TCP")
	output, err := cmd.Output()
	if err != nil {
		return 0
	}

	target := fmt.Sprintf(":%d", port)
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		if strings.HasSuffix(fields[1], target) && strings.EqualFold(fields[3], "LISTENING") {
			pid, err := strconv.Atoi(fields[4])
			if err == nil {
				return pid
			}
		}
	}
	return 0
}

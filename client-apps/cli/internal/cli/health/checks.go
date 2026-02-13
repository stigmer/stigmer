package health

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ProcessHealthCheck checks if a process is alive by PID
func ProcessHealthCheck(pid int) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		if pid <= 0 {
			return fmt.Errorf("invalid PID: %d", pid)
		}

		process, err := os.FindProcess(pid)
		if err != nil {
			return fmt.Errorf("process not found: %w", err)
		}

		// Send signal 0 to check if process is alive
		// This doesn't actually send a signal, just checks if we can
		if err := process.Signal(syscall.Signal(0)); err != nil {
			return fmt.Errorf("process not running: %w", err)
		}

		return nil
	}
}

// GRPCHealthCheck checks if a gRPC server is responding
func GRPCHealthCheck(address string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Try to establish connection with timeout from context
		conn, err := grpc.DialContext(ctx, address,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithBlock(),
		)
		if err != nil {
			return fmt.Errorf("grpc connection failed: %w", err)
		}
		defer conn.Close()

		// Successfully connected - server is responding
		return nil
	}
}

// CombinedHealthCheck combines multiple health checks
// Returns error on first failure
func CombinedHealthCheck(checks ...func(ctx context.Context) error) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		for _, check := range checks {
			if err := check(ctx); err != nil {
				return err
			}
		}
		return nil
	}
}

// StigmerServerHealthCheck creates health check for stigmer-server
func StigmerServerHealthCheck(pid int, grpcAddress string) func(ctx context.Context) error {
	return CombinedHealthCheck(
		ProcessHealthCheck(pid),
		GRPCHealthCheck(grpcAddress),
	)
}

// WorkflowRunnerHealthCheck creates health check for workflow-runner
func WorkflowRunnerHealthCheck(pid int, startTime time.Time, minUptime time.Duration) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Check process is alive
		if err := ProcessHealthCheck(pid)(ctx); err != nil {
			return err
		}

		// Check minimum uptime (avoid marking healthy if crash looping)
		uptime := time.Since(startTime)
		if uptime < minUptime {
			return fmt.Errorf("insufficient uptime: %s (minimum: %s)", uptime, minUptime)
		}

		return nil
	}
}

// DockerContainerHealthCheck checks if a Docker container is running and healthy.
// It detects restart loops by checking the container's restart count and restarting state.
func DockerContainerHealthCheck(containerName string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Check if docker is available
		if _, err := exec.LookPath("docker"); err != nil {
			return fmt.Errorf("docker not found: %w", err)
		}

		// Check if container exists (running or stopped)
		cmd := exec.CommandContext(ctx, "docker", "ps", "-a",
			"--filter", fmt.Sprintf("name=^%s$", containerName),
			"--format", "{{.Names}}")

		output, err := cmd.Output()
		if err != nil {
			return fmt.Errorf("failed to check container status: %w", err)
		}

		containerNames := strings.TrimSpace(string(output))
		if containerNames == "" {
			return fmt.Errorf("container %s not found", containerName)
		}

		// Get extended status: running, restarting, restart count, exit code
		// Format: "{{.State.Running}}|{{.State.Restarting}}|{{.RestartCount}}|{{.State.ExitCode}}"
		cmd = exec.CommandContext(ctx, "docker", "inspect",
			"--format", "{{.State.Running}}|{{.State.Restarting}}|{{.RestartCount}}|{{.State.ExitCode}}",
			containerName)

		output, err = cmd.Output()
		if err != nil {
			return fmt.Errorf("failed to inspect container: %w", err)
		}

		parts := strings.Split(strings.TrimSpace(string(output)), "|")
		if len(parts) != 4 {
			return fmt.Errorf("unexpected docker inspect output format")
		}

		running := parts[0] == "true"
		restarting := parts[1] == "true"
		restartCount := 0
		exitCode := 0

		if rc, err := parseIntOrZero(parts[2]); err == nil {
			restartCount = rc
		}
		if ec, err := parseIntOrZero(parts[3]); err == nil {
			exitCode = ec
		}

		// Check for crash loop: restarting state or high restart count with failure
		if restarting {
			return fmt.Errorf("container is restarting (crash loop detected, %d restarts)", restartCount)
		}

		// Container not running
		if !running {
			if exitCode != 0 {
				return fmt.Errorf("container stopped with exit code %d (%d restarts)", exitCode, restartCount)
			}
			return fmt.Errorf("container %s not running", containerName)
		}

		// Container is running but has high restart count - likely recovering from crash loop
		if restartCount >= 3 {
			// This is a warning state - container is running but has been unstable
			// We don't fail the health check since it's currently running,
			// but this info will be captured in extended status
		}

		// Check container health status (if container has healthcheck defined)
		cmd = exec.CommandContext(ctx, "docker", "inspect",
			"--format", "{{.State.Health.Status}}",
			containerName)

		output, err = cmd.Output()
		if err == nil {
			healthStatus := strings.TrimSpace(string(output))
			// Only fail if explicitly unhealthy (ignore if no healthcheck defined)
			if healthStatus == "unhealthy" {
				return fmt.Errorf("container health status: unhealthy")
			}
		}

		return nil
	}
}

// parseIntOrZero parses a string to int, returning 0 on error
func parseIntOrZero(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	var result int
	_, err := fmt.Sscanf(s, "%d", &result)
	return result, err
}

// AgentRunnerHealthCheck creates health check for agent-runner (Docker mode)
func AgentRunnerHealthCheck(containerName string) func(ctx context.Context) error {
	return DockerContainerHealthCheck(containerName)
}

// TemporalHealthCheck checks if Temporal server is responding
func TemporalHealthCheck(address string) func(ctx context.Context) error {
	// Temporal uses gRPC, so we can use the gRPC health check
	return GRPCHealthCheck(address)
}

// FileExistsHealthCheck checks if a file exists (useful for PID files, lock files)
func FileExistsHealthCheck(path string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return fmt.Errorf("file does not exist: %s", path)
			}
			return fmt.Errorf("failed to check file: %w", err)
		}
		return nil
	}
}

// PortListeningCheck checks if a port is listening (TCP)
func PortListeningCheck(address string) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// Try to establish a basic TCP connection
		conn, err := grpc.DialContext(ctx, address,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithBlock(),
		)
		if err != nil {
			return fmt.Errorf("port not listening: %w", err)
		}
		conn.Close()
		return nil
	}
}

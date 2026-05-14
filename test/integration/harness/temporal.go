package harness

import (
	"context"
	"fmt"
	"net"
	"os/exec"
	"time"
)

type TemporalDevServer struct {
	cmd  *exec.Cmd
	Host string
	Port string
}

// StartTemporal starts the Temporal CLI dev server on a free port.
// Requires `temporal` CLI to be on PATH.
func StartTemporal(ctx context.Context) (*TemporalDevServer, error) {
	port, err := freePort()
	if err != nil {
		return nil, fmt.Errorf("allocate free port for temporal: %w", err)
	}

	addr := fmt.Sprintf("127.0.0.1:%d", port)

	cmd := exec.CommandContext(ctx, "temporal", "server", "start-dev",
		"--port", fmt.Sprintf("%d", port),
		"--namespace", "default",
		"--log-format", "json",
		"--headless",
	)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start temporal dev server: %w", err)
	}

	if err := waitForPort(ctx, addr, 30*time.Second); err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("temporal dev server did not become ready: %w", err)
	}

	return &TemporalDevServer{
		cmd:  cmd,
		Host: "127.0.0.1",
		Port: fmt.Sprintf("%d", port),
	}, nil
}

func (t *TemporalDevServer) Address() string {
	return fmt.Sprintf("%s:%s", t.Host, t.Port)
}

func (t *TemporalDevServer) Stop() error {
	if t.cmd == nil || t.cmd.Process == nil {
		return nil
	}
	return t.cmd.Process.Kill()
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func waitForPort(ctx context.Context, addr string, timeout time.Duration) error {
	return waitForPortOrExit(ctx, addr, timeout, nil)
}

func waitForPortOrExit(ctx context.Context, addr string, timeout time.Duration, exitCh <-chan error) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-exitCh:
			if err != nil {
				return fmt.Errorf("process exited before port became ready: %w", err)
			}
			return fmt.Errorf("process exited cleanly before port became ready")
		default:
		}
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("port %s not reachable after %v", addr, timeout)
}

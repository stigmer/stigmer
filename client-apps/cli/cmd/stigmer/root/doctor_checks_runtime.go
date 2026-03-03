package root

import (
	"context"
	"fmt"
	"os"
	"time"

	"golang.org/x/term"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// doctorConnectTimeout is the gRPC dial timeout used by the server check.
// Shorter than NewConnection's 10s — fast failure is more useful for diagnostics.
const doctorConnectTimeout = 5 * time.Second

func checkServer(cfg *config.Config) (checkResult, *backend.Client) {
	r := checkResult{name: "Server"}

	client, err := backend.NewClient(cfg)
	if err != nil {
		r.status = statusFail
		r.fields = []checkField{{key: "Connectivity", value: fmt.Sprintf("Configuration error %s", statusSymbol(statusFail))}}
		r.hint = "Check backend configuration: stigmer backend"
		return r, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), doctorConnectTimeout)
	defer cancel()

	if err := client.Connect(ctx); err != nil {
		r.status = statusFail
		r.fields = []checkField{{key: "Connectivity", value: fmt.Sprintf("Unreachable %s", statusSymbol(statusFail))}}

		if cfg.Backend.Type == config.BackendTypeLocal {
			r.hint = "Start the server: stigmer server"
		} else {
			r.hint = "Check your network connection and endpoint configuration"
		}
		return r, nil
	}

	pingCtx, pingCancel := context.WithTimeout(context.Background(), doctorConnectTimeout)
	defer pingCancel()

	start := time.Now()
	if err := client.Ping(pingCtx); err != nil {
		r.status = statusWarn
		r.fields = []checkField{
			{key: "Connectivity", value: fmt.Sprintf("Connected but not responding %s", statusSymbol(statusWarn))},
		}
		r.hint = "Server accepted connection but did not respond to health check"
		return r, client
	}
	latency := time.Since(start)

	r.status = statusPass
	r.fields = []checkField{
		{key: "Connectivity", value: fmt.Sprintf("Connected %s", statusSymbol(statusPass))},
		{key: "Latency", value: formatLatency(latency)},
	}
	return r, client
}

func checkTerminal() checkResult {
	r := checkResult{name: "Terminal"}

	stdinTTY := term.IsTerminal(int(os.Stdin.Fd()))
	stdoutTTY := term.IsTerminal(int(os.Stdout.Fd()))
	stderrTTY := term.IsTerminal(int(os.Stderr.Fd()))

	r.fields = []checkField{
		{key: "stdin", value: ttyLabel(stdinTTY)},
		{key: "stdout", value: ttyLabel(stdoutTTY)},
		{key: "stderr", value: ttyLabel(stderrTTY)},
	}

	if termEnv := os.Getenv("TERM"); termEnv != "" {
		r.fields = append(r.fields, checkField{key: "TERM", value: termEnv})
	} else {
		r.fields = append(r.fields, checkField{key: "TERM", value: "(not set)"})
	}

	if stdoutTTY {
		width, height, err := term.GetSize(int(os.Stdout.Fd()))
		if err == nil {
			r.fields = append(r.fields, checkField{
				key:   "Dimensions",
				value: fmt.Sprintf("%d×%d", width, height),
			})
		}
	}

	noColor := os.Getenv("NO_COLOR")
	if noColor != "" {
		r.fields = append(r.fields, checkField{key: "Color", value: "Disabled (NO_COLOR set)"})
	} else {
		r.fields = append(r.fields, checkField{key: "Color", value: "Enabled"})
	}

	if !stdoutTTY && !stderrTTY {
		r.status = statusWarn
		r.hint = "Running in a non-interactive environment — consider --json flag for scripting"
	} else {
		r.status = statusPass
	}

	return r
}

func ttyLabel(isTTY bool) string {
	if isTTY {
		return fmt.Sprintf("TTY %s", statusSymbol(statusPass))
	}
	return fmt.Sprintf("Not a TTY %s", statusSymbol(statusWarn))
}

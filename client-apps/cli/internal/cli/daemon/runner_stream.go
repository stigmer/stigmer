package daemon

import (
	"context"
	"errors"
	"math/rand"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	runnerv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/runner/v1"
)

// ErrServerRequestedStop is returned by Run when the server sends a stop
// command via the bidi stream. The caller should treat this as a clean
// shutdown signal (not a reconnectable error).
var ErrServerRequestedStop = errors.New("server requested runner stop")

const (
	defaultHeartbeatInterval = 30 * time.Second

	reconnectBaseDelay = 1 * time.Second
	reconnectMaxDelay  = 60 * time.Second
	reconnectJitter    = 0.25
)

// CommandStream abstracts the bidi stream so the client works with both the
// SDK wrapper (gen.RunnerConnectStream) and the raw gRPC stream.
type CommandStream interface {
	Send(*runnerv1.RunnerStreamClientMessage) error
	Recv() (*runnerv1.RunnerStreamServerMessage, error)
	CloseSend() error
}

// RunnerStreamConfig holds the parameters for a RunnerStreamClient.
type RunnerStreamConfig struct {
	RunnerID          string
	ConnectFn         func(ctx context.Context) (CommandStream, error)
	HeartbeatInterval time.Duration
	InitialPhase      runnerv1.RunnerPhase // defaults to READY if unset
}

// RunnerStreamClient maintains a persistent bidi stream to the server,
// sending heartbeats and handling server-initiated commands. It reconnects
// automatically with exponential backoff on stream errors.
//
// The reported phase can be changed at runtime via SetPhase, which triggers
// an immediate heartbeat so the server sees the transition without waiting
// for the next tick.
type RunnerStreamClient struct {
	runnerID          string
	connectFn         func(ctx context.Context) (CommandStream, error)
	heartbeatInterval time.Duration
	connectionInfo    *runnerv1.RunnerConnectionInfo

	phaseMu      sync.Mutex
	currentPhase runnerv1.RunnerPhase
	phaseChanged chan struct{}
}

// NewRunnerStreamClient creates a stream client. Call Run to start it.
func NewRunnerStreamClient(cfg RunnerStreamConfig) *RunnerStreamClient {
	interval := cfg.HeartbeatInterval
	if interval == 0 {
		interval = defaultHeartbeatInterval
	}

	initialPhase := cfg.InitialPhase
	if initialPhase == runnerv1.RunnerPhase_RUNNER_PHASE_UNSPECIFIED {
		initialPhase = runnerv1.RunnerPhase_RUNNER_PHASE_READY
	}

	hostname, _ := os.Hostname()

	return &RunnerStreamClient{
		runnerID:          cfg.RunnerID,
		connectFn:         cfg.ConnectFn,
		heartbeatInterval: interval,
		currentPhase:      initialPhase,
		phaseChanged:      make(chan struct{}, 1),
		connectionInfo: &runnerv1.RunnerConnectionInfo{
			Hostname:      hostname,
			Os:            runtime.GOOS,
			Arch:          runtime.GOARCH,
			RunnerVersion: embedded.GetBuildVersion(),
		},
	}
}

// SetPhase updates the phase reported in subsequent heartbeats and triggers
// an immediate heartbeat on the active stream so the server sees the
// transition promptly. Safe to call from any goroutine.
func (c *RunnerStreamClient) SetPhase(phase runnerv1.RunnerPhase) {
	c.phaseMu.Lock()
	if c.currentPhase == phase {
		c.phaseMu.Unlock()
		return
	}
	c.currentPhase = phase
	c.phaseMu.Unlock()

	select {
	case c.phaseChanged <- struct{}{}:
	default:
	}
}

func (c *RunnerStreamClient) getPhase() runnerv1.RunnerPhase {
	c.phaseMu.Lock()
	defer c.phaseMu.Unlock()
	return c.currentPhase
}

// Run opens the bidi stream and enters the heartbeat/recv loop. It blocks
// until ctx is cancelled, reconnecting automatically on stream errors.
//
// On graceful shutdown (ctx cancelled), Run sends a best-effort STOPPED
// heartbeat before closing the stream.
func (c *RunnerStreamClient) Run(ctx context.Context) error {
	backoff := reconnectBaseDelay

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		streamCtx, streamCancel := context.WithCancel(ctx)
		stream, err := c.connectFn(streamCtx)
		if err != nil {
			streamCancel()

			if ctx.Err() != nil {
				return ctx.Err()
			}

			log.Warn().
				Err(err).
				Str("runner_id", c.runnerID).
				Dur("retry_in", backoff).
				Msg("Failed to open command stream, will retry")

			if !c.sleepWithContext(ctx, withJitter(backoff)) {
				return ctx.Err()
			}
			backoff = nextBackoff(backoff)
			continue
		}

		backoff = reconnectBaseDelay

		log.Info().
			Str("runner_id", c.runnerID).
			Msg("Command stream connected")

		loopErr := c.streamLoop(ctx, streamCtx, streamCancel, stream)

		if ctx.Err() != nil {
			return ctx.Err()
		}

		if errors.Is(loopErr, ErrServerRequestedStop) {
			return ErrServerRequestedStop
		}

		log.Warn().
			Err(loopErr).
			Str("runner_id", c.runnerID).
			Dur("retry_in", backoff).
			Msg("Command stream disconnected, will reconnect")

		if !c.sleepWithContext(ctx, withJitter(backoff)) {
			return ctx.Err()
		}
		backoff = nextBackoff(backoff)
	}
}

// streamLoop runs the heartbeat ticker and recv loop for a single stream
// connection. It returns when the stream breaks or ctx is cancelled.
func (c *RunnerStreamClient) streamLoop(
	parentCtx context.Context,
	streamCtx context.Context,
	streamCancel context.CancelFunc,
	stream CommandStream,
) error {
	defer streamCancel()

	var sendMu sync.Mutex

	if err := c.sendHeartbeat(&sendMu, stream, c.getPhase()); err != nil {
		return err
	}

	recvErrCh := make(chan error, 1)
	go func() {
		recvErrCh <- c.recvLoop(streamCtx, &sendMu, stream)
	}()

	ticker := time.NewTicker(c.heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-parentCtx.Done():
			c.sendGracefulStop(&sendMu, stream)
			return parentCtx.Err()

		case err := <-recvErrCh:
			if errors.Is(err, ErrServerRequestedStop) {
				c.sendGracefulStop(&sendMu, stream)
			}
			return err

		case <-c.phaseChanged:
			if err := c.sendHeartbeat(&sendMu, stream, c.getPhase()); err != nil {
				return err
			}

		case <-ticker.C:
			if err := c.sendHeartbeat(&sendMu, stream, c.getPhase()); err != nil {
				return err
			}
		}
	}
}

// recvLoop reads server messages and dispatches commands. It returns on
// stream error or context cancellation.
func (c *RunnerStreamClient) recvLoop(
	ctx context.Context,
	sendMu *sync.Mutex,
	stream CommandStream,
) error {
	for {
		msg, err := stream.Recv()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}

		cmdReq := msg.GetCommandRequest()
		if cmdReq == nil {
			log.Warn().
				Str("runner_id", c.runnerID).
				Msg("Received server message with no command_request, ignoring")
			continue
		}

		result := dispatchCommand(c.runnerID, cmdReq)

		clientMsg := &runnerv1.RunnerStreamClientMessage{
			Message: &runnerv1.RunnerStreamClientMessage_CommandResponse{
				CommandResponse: result.response,
			},
		}

		sendMu.Lock()
		err = stream.Send(clientMsg)
		sendMu.Unlock()

		if err != nil {
			return err
		}

		if result.stopRequested {
			return ErrServerRequestedStop
		}
	}
}

// sendHeartbeat sends a single heartbeat message under the send mutex.
func (c *RunnerStreamClient) sendHeartbeat(
	sendMu *sync.Mutex,
	stream CommandStream,
	phase runnerv1.RunnerPhase,
) error {
	msg := &runnerv1.RunnerStreamClientMessage{
		Message: &runnerv1.RunnerStreamClientMessage_Heartbeat{
			Heartbeat: &runnerv1.RunnerHeartbeat{
				RunnerId:          c.runnerID,
				Phase:             phase,
				CurrentExecutions: 0,
				ConnectionInfo:    c.connectionInfo,
			},
		},
	}

	sendMu.Lock()
	err := stream.Send(msg)
	sendMu.Unlock()

	if err != nil {
		log.Warn().
			Err(err).
			Str("runner_id", c.runnerID).
			Str("phase", phase.String()).
			Msg("Failed to send heartbeat")
	}

	return err
}

// sendGracefulStop sends a best-effort STOPPED heartbeat and closes the
// send side of the stream. Errors are logged but not returned — shutdown
// must not block on a broken stream.
func (c *RunnerStreamClient) sendGracefulStop(sendMu *sync.Mutex, stream CommandStream) {
	log.Info().
		Str("runner_id", c.runnerID).
		Msg("Sending STOPPED heartbeat before disconnect")

	_ = c.sendHeartbeat(sendMu, stream, runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED)
	_ = stream.CloseSend()
}

// sleepWithContext blocks for the given duration or until ctx is cancelled.
// Returns true if the sleep completed, false if interrupted by cancellation.
func (c *RunnerStreamClient) sleepWithContext(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// nextBackoff doubles the delay up to reconnectMaxDelay.
func nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > reconnectMaxDelay {
		return reconnectMaxDelay
	}
	return next
}

// withJitter adds random jitter (0 to reconnectJitter fraction) to a duration.
func withJitter(d time.Duration) time.Duration {
	jitter := time.Duration(float64(d) * reconnectJitter * rand.Float64())
	return d + jitter
}

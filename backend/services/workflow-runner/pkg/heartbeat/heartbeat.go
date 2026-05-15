/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Package heartbeat provides a bidi-stream heartbeat client for the
// workflow-runner. It opens a RunnerCommandController.connect stream
// and sends periodic RunnerHeartbeat messages with process_type="workflow",
// allowing the server to track this process independently for multi-process
// sandbox lifecycle management.
//
// In sandbox mode (STIGMER_RUNNER_ID set), heartbeats report the runner's
// activity level so the server can aggregate idle state across all three
// runner processes (agent, cursor, workflow) before deciding to deprovision.
//
// In local/OSS mode (STIGMER_RUNNER_ID empty), the client is a no-op.
package heartbeat

import (
	"context"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

const (
	processType       = "workflow"
	heartbeatInterval = 30 * time.Second
	reconnectDelay    = 5 * time.Second
)

// Client sends periodic heartbeats over the RunnerCommandController.connect
// bidi stream. Safe to call Start/Stop from any goroutine; Start is
// idempotent and Stop blocks until the heartbeat loop exits.
type Client struct {
	runnerID string
	apiKey   string
	endpoint string
	useTLS   bool
	counter  *ActivityCounter

	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewClient creates a heartbeat client. Returns nil when runnerID is empty
// (local/OSS mode) or when stigmerCfg is nil.
func NewClient(runnerID string, stigmerCfg *config.StigmerConfig, counter *ActivityCounter) *Client {
	if runnerID == "" {
		log.Info().Msg("Heartbeat client disabled (STIGMER_RUNNER_ID not set — local/OSS mode)")
		return nil
	}

	if stigmerCfg == nil {
		log.Warn().Msg("Heartbeat client disabled (no Stigmer backend config)")
		return nil
	}

	return &Client{
		runnerID: runnerID,
		apiKey:   stigmerCfg.APIKey,
		endpoint: stigmerCfg.Endpoint,
		useTLS:   stigmerCfg.UseTLS,
		counter:  counter,
	}
}

// Start begins the heartbeat loop in a background goroutine. No-op if the
// client is nil (local/OSS mode). Safe to call multiple times.
func (c *Client) Start() {
	if c == nil {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	c.wg.Add(1)

	go func() {
		defer c.wg.Done()
		c.run(ctx)
	}()

	log.Info().
		Str("runner_id", c.runnerID).
		Str("process_type", processType).
		Dur("interval", heartbeatInterval).
		Msg("Heartbeat client started")
}

// Stop cancels the heartbeat loop and waits for it to exit. No-op if the
// client is nil or was never started.
func (c *Client) Stop() {
	if c == nil || c.cancel == nil {
		return
	}
	c.cancel()
	c.wg.Wait()
	log.Info().Msg("Heartbeat client stopped")
}

func (c *Client) run(ctx context.Context) {
	for {
		err := c.streamLoop(ctx)
		if ctx.Err() != nil {
			return
		}
		log.Warn().Err(err).
			Dur("reconnect_delay", reconnectDelay).
			Msg("Heartbeat stream disconnected, reconnecting")

		select {
		case <-ctx.Done():
			return
		case <-time.After(reconnectDelay):
		}
	}
}

func (c *Client) streamLoop(ctx context.Context) error {
	conn, err := c.dial()
	if err != nil {
		return err
	}
	defer conn.Close()

	authCtx := metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+c.apiKey)
	client := runnerv1.NewRunnerCommandControllerClient(conn)

	stream, err := client.Connect(authCtx)
	if err != nil {
		return err
	}

	// First message must be a heartbeat to authenticate the stream.
	if err := c.sendHeartbeat(stream); err != nil {
		return err
	}

	// Listen for server commands in the background.
	serverDone := make(chan error, 1)
	go func() {
		serverDone <- c.receiveLoop(ctx, stream)
	}()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = stream.CloseSend()
			return ctx.Err()
		case err := <-serverDone:
			return err
		case <-ticker.C:
			if err := c.sendHeartbeat(stream); err != nil {
				return err
			}
		}
	}
}

func (c *Client) sendHeartbeat(
	stream grpc.BidiStreamingClient[runnerv1.RunnerStreamClientMessage, runnerv1.RunnerStreamServerMessage],
) error {
	execCount := c.counter.Count()
	phase := runnerv1.RunnerPhase_RUNNER_PHASE_READY
	if execCount > 0 {
		phase = runnerv1.RunnerPhase_RUNNER_PHASE_BUSY
	}

	hostname, _ := os.Hostname()

	msg := &runnerv1.RunnerStreamClientMessage{
		Message: &runnerv1.RunnerStreamClientMessage_Heartbeat{
			Heartbeat: &runnerv1.RunnerHeartbeat{
				RunnerId:          c.runnerID,
				Phase:             phase,
				CurrentExecutions: execCount,
				ProcessType:       processType,
				ConnectionInfo: &runnerv1.RunnerConnectionInfo{
					Hostname: hostname,
					Os:       runtime.GOOS,
					Arch:     runtime.GOARCH,
				},
			},
		},
	}

	if err := stream.Send(msg); err != nil {
		log.Warn().Err(err).Int32("executions", execCount).Msg("Failed to send heartbeat")
		return err
	}

	log.Debug().
		Int32("executions", execCount).
		Str("phase", phase.String()).
		Msg("Heartbeat sent")
	return nil
}

// receiveLoop reads server-pushed commands. Currently handles StopRunner
// by logging a warning — the actual process shutdown is triggered by the
// Daytona sandbox deletion that follows server-side deprovisioning.
func (c *Client) receiveLoop(
	ctx context.Context,
	stream grpc.BidiStreamingClient[runnerv1.RunnerStreamClientMessage, runnerv1.RunnerStreamServerMessage],
) error {
	for {
		msg, err := stream.Recv()
		if err != nil {
			return err
		}
		if cmd := msg.GetCommandRequest(); cmd != nil {
			if cmd.GetStop() != nil {
				log.Warn().
					Str("reason", cmd.GetStop().GetReason()).
					Msg("Received stop command from server")
			}
		}
	}
}

func (c *Client) dial() (*grpc.ClientConn, error) {
	var opts []grpc.DialOption
	if c.useTLS {
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(nil)))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}
	return grpc.NewClient(c.endpoint, opts...)
}

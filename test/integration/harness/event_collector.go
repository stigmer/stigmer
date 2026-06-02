package harness

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// EventCollector subscribes to a workflow execution's event stream and
// accumulates events for assertion. It runs a background goroutine that
// reads from the SubscribeEvents gRPC stream until the context is cancelled
// or the stream ends.
//
// Usage:
//
//	collector := harness.NewEventCollector(clients.ExecutionQuery, executionID, logger)
//	collector.Start(ctx)
//	defer collector.Stop()
//	// ... wait for execution to progress ...
//	evt, err := collector.WaitForEventType(ctx, workflowexecutionv1.WorkflowEventType_agent_call_progress, 60*time.Second)
type EventCollector struct {
	client      workflowexecutionv1.WorkflowExecutionQueryControllerClient
	executionID string
	logger      *slog.Logger

	mu     sync.Mutex
	events []*workflowexecutionv1.WorkflowExecutionEvent
	notify chan struct{} // closed and re-created on each new event

	cancel context.CancelFunc
	done   chan struct{}
	err    error
}

// NewEventCollector creates a collector for the given execution. Call Start to begin streaming.
func NewEventCollector(
	client workflowexecutionv1.WorkflowExecutionQueryControllerClient,
	executionID string,
	logger *slog.Logger,
) *EventCollector {
	if logger == nil {
		logger = slog.Default()
	}
	return &EventCollector{
		client:      client,
		executionID: executionID,
		logger:      logger,
		notify:      make(chan struct{}),
		done:        make(chan struct{}),
	}
}

// Start opens the SubscribeEvents stream and begins collecting events
// in a background goroutine. The stream runs until ctx is cancelled,
// the server closes it, or Stop is called.
func (c *EventCollector) Start(ctx context.Context) error {
	streamCtx, cancel := context.WithCancel(ctx)
	c.cancel = cancel

	stream, err := c.client.SubscribeEvents(streamCtx,
		&workflowexecutionv1.SubscribeEventsRequest{
			ExecutionId:   c.executionID,
			AfterSequence: 0,
		})
	if err != nil {
		cancel()
		close(c.done)
		return err
	}

	go func() {
		defer close(c.done)
		defer cancel()
		for {
			evt, recvErr := stream.Recv()
			if recvErr != nil {
				if !errors.Is(recvErr, io.EOF) && !errors.Is(recvErr, context.Canceled) {
					c.mu.Lock()
					c.err = recvErr
					c.mu.Unlock()
					c.logger.Debug("event stream ended with error",
						"execution_id", c.executionID,
						"error", recvErr)
				}
				return
			}

			c.mu.Lock()
			c.events = append(c.events, evt)
			// Signal waiters by closing the current notify channel and creating a new one.
			close(c.notify)
			c.notify = make(chan struct{})
			c.mu.Unlock()

			c.logger.Debug("event collected",
				"execution_id", c.executionID,
				"type", evt.GetEventType().String(),
				"task", evt.GetTaskName(),
				"seq", evt.GetSequenceNumber(),
			)
		}
	}()

	return nil
}

// Stop cancels the stream and waits for the background goroutine to finish.
func (c *EventCollector) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
	<-c.done
}

// AllEvents returns a snapshot of all collected events.
func (c *EventCollector) AllEvents() []*workflowexecutionv1.WorkflowExecutionEvent {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]*workflowexecutionv1.WorkflowExecutionEvent, len(c.events))
	copy(out, c.events)
	return out
}

// EventsByType returns all collected events matching the given type.
func (c *EventCollector) EventsByType(t workflowexecutionv1.WorkflowEventType) []*workflowexecutionv1.WorkflowExecutionEvent {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []*workflowexecutionv1.WorkflowExecutionEvent
	for _, evt := range c.events {
		if evt.GetEventType() == t {
			out = append(out, evt)
		}
	}
	return out
}

// WaitForEventType blocks until an event of the given type is collected
// or the timeout expires. Returns the first matching event.
func (c *EventCollector) WaitForEventType(
	ctx context.Context,
	t workflowexecutionv1.WorkflowEventType,
	timeout time.Duration,
) (*workflowexecutionv1.WorkflowExecutionEvent, error) {
	deadline := time.After(timeout)
	for {
		if evts := c.EventsByType(t); len(evts) > 0 {
			return evts[0], nil
		}

		c.mu.Lock()
		ch := c.notify
		c.mu.Unlock()

		select {
		case <-ch:
			// New event arrived, check again.
		case <-deadline:
			return nil, &EventTimeoutError{EventType: t, ExecutionID: c.executionID, Timeout: timeout, Collected: c.AllEvents()}
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-c.done:
			// Stream ended. Check one last time.
			if evts := c.EventsByType(t); len(evts) > 0 {
				return evts[0], nil
			}
			return nil, &EventTimeoutError{EventType: t, ExecutionID: c.executionID, Timeout: timeout, Collected: c.AllEvents()}
		}
	}
}

// Err returns the stream error, if any. Returns nil if the stream ended normally (EOF/cancelled).
func (c *EventCollector) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.err
}

// EventTimeoutError is returned when WaitForEventType times out.
// It includes the events that were collected for diagnostic logging.
type EventTimeoutError struct {
	EventType   workflowexecutionv1.WorkflowEventType
	ExecutionID string
	Timeout     time.Duration
	Collected   []*workflowexecutionv1.WorkflowExecutionEvent
}

func (e *EventTimeoutError) Error() string {
	types := make([]string, len(e.Collected))
	for i, evt := range e.Collected {
		types[i] = evt.GetEventType().String()
	}
	return "timed out waiting for event " + e.EventType.String() +
		" on execution " + e.ExecutionID +
		" after " + e.Timeout.String() +
		"; collected " + intToStr(len(e.Collected)) + " events: " + joinStrings(types)
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

func joinStrings(ss []string) string {
	if len(ss) == 0 {
		return "[]"
	}
	out := "["
	for i, s := range ss {
		if i > 0 {
			out += ", "
		}
		out += s
	}
	return out + "]"
}

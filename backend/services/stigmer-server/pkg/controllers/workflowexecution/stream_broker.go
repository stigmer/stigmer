package workflowexecution

import (
	"sync"

	"github.com/rs/zerolog/log"
	workflowexecutionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflowexecution/v1"
)

// StreamBroker manages in-memory Go channels for real-time execution updates
//
// This implements the "Stream Broker" responsibility from ADR 011:
// > Stream Broker: Manages in-memory Go Channels to broadcast real-time updates to CLI watchers.
//
// Architecture:
// - When UpdateStatus is called, the broker broadcasts to all active subscribers
// - When Subscribe is called, a new channel is created and registered
// - When a subscriber disconnects, the channel is cleaned up
//
// This eliminates the need for polling and provides near-instant updates as per ADR.
type StreamBroker struct {
	mu          sync.RWMutex
	subscribers map[string][]chan *workflowexecutionv1.WorkflowExecution
}

// NewStreamBroker creates a new StreamBroker instance
func NewStreamBroker() *StreamBroker {
	return &StreamBroker{
		subscribers: make(map[string][]chan *workflowexecutionv1.WorkflowExecution),
	}
}

// Subscribe creates a new channel for the given execution ID and registers it
//
// The returned channel will receive all future updates for this execution.
// The caller MUST call Unsubscribe when done to prevent channel leaks.
//
// Returns:
// - A channel that receives WorkflowExecution updates
func (b *StreamBroker) Subscribe(executionID string) chan *workflowexecutionv1.WorkflowExecution {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Create buffered channel to prevent blocking broadcasts
	// Buffer size of 100 allows bursts of updates without blocking
	ch := make(chan *workflowexecutionv1.WorkflowExecution, 100)

	// Register subscriber
	b.subscribers[executionID] = append(b.subscribers[executionID], ch)

	log.Debug().
		Str("execution_id", executionID).
		Int("total_subscribers", len(b.subscribers[executionID])).
		Msg("New subscriber registered")

	return ch
}

// Unsubscribe removes a channel from the subscriber list and closes it
//
// This should be called when:
// - The client disconnects
// - The execution reaches a terminal state
// - The subscription is cancelled
func (b *StreamBroker) Unsubscribe(executionID string, ch chan *workflowexecutionv1.WorkflowExecution) {
	b.mu.Lock()
	defer b.mu.Unlock()

	subscribers, exists := b.subscribers[executionID]
	if !exists {
		return
	}

	// Find and remove the channel
	for i, subscriber := range subscribers {
		if subscriber == ch {
			// Remove from slice
			b.subscribers[executionID] = append(subscribers[:i], subscribers[i+1:]...)

			// Close the channel
			close(ch)

			log.Debug().
				Str("execution_id", executionID).
				Int("remaining_subscribers", len(b.subscribers[executionID])).
				Msg("Subscriber unregistered")

			// Clean up empty entries
			if len(b.subscribers[executionID]) == 0 {
				delete(b.subscribers, executionID)
			}

			break
		}
	}
}

// Broadcast sends an execution update to all active subscribers
//
// This is called after UpdateStatus persists to the database.
// It implements the "Daemon (Streaming): Pushes message to active Go Channels" step from ADR 011.
//
// The broadcast is non-blocking - if a channel's buffer is full, the update is dropped
// for that subscriber (they'll get the next one).
func (b *StreamBroker) Broadcast(execution *workflowexecutionv1.WorkflowExecution) {
	if execution == nil || execution.Metadata == nil {
		return
	}

	executionID := execution.Metadata.Id

	b.mu.RLock()
	defer b.mu.RUnlock()

	subscribers, exists := b.subscribers[executionID]
	if !exists || len(subscribers) == 0 {
		// No subscribers, nothing to do
		return
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", execution.Status.GetPhase().String()).
		Int("subscribers", len(subscribers)).
		Msg("Broadcasting execution update")

	// Broadcast to all subscribers
	for _, ch := range subscribers {
		select {
		case ch <- execution:
			// Successfully sent
		default:
			// Channel buffer full, drop this update
			// Subscriber will get the next update
			log.Warn().
				Str("execution_id", executionID).
				Msg("Subscriber channel full, dropping update")
		}
	}
}

// GetSubscriberCount returns the number of active subscribers for an execution
//
// This is useful for debugging and monitoring.
func (b *StreamBroker) GetSubscriberCount(executionID string) int {
	b.mu.RLock()
	defer b.mu.RUnlock()

	return len(b.subscribers[executionID])
}

package temporal

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	// DefaultHealthCheckInterval is how often to check Temporal health
	DefaultHealthCheckInterval = 5 * time.Second
	
	// RestartBackoffDelay is the delay before attempting restart after failure
	RestartBackoffDelay = 1 * time.Second
)

// Supervisor monitors Temporal health and automatically restarts on failure
type Supervisor struct {
	manager           *Manager
	ctx               context.Context
	cancel            context.CancelFunc
	healthCheckInterval time.Duration
}

// NewSupervisor creates a new Temporal supervisor
func NewSupervisor(manager *Manager) *Supervisor {
	ctx, cancel := context.WithCancel(context.Background())
	
	return &Supervisor{
		manager:           manager,
		ctx:               ctx,
		cancel:            cancel,
		healthCheckInterval: DefaultHealthCheckInterval,
	}
}

// Start begins monitoring Temporal and auto-restarting on failure
// This function spawns a goroutine and returns immediately.
// The goroutine will run until Stop() is called or context is cancelled.
func (s *Supervisor) Start() {
	log.Info().
		Dur("interval", s.healthCheckInterval).
		Msg("Starting Temporal supervisor")
	
	go s.run()
}

// Stop gracefully stops the supervisor
func (s *Supervisor) Stop() {
	log.Info().Msg("Stopping Temporal supervisor")
	s.cancel()
}

// run is the main supervisor loop
func (s *Supervisor) run() {
	ticker := time.NewTicker(s.healthCheckInterval)
	defer ticker.Stop()
	
	for {
		select {
		case <-s.ctx.Done():
			log.Debug().Msg("Supervisor context cancelled, stopping")
			return
			
		case <-ticker.C:
			s.checkHealthAndRestart()
		}
	}
}

// checkHealthAndRestart checks Temporal health and restarts if unhealthy
func (s *Supervisor) checkHealthAndRestart() {
	// Check if Temporal is running and healthy
	if s.manager.IsRunning() {
		log.Debug().Msg("Temporal health check passed")
		return
	}
	
	// Temporal is not running or unhealthy - attempt restart
	log.Warn().Msg("Temporal health check failed - process not running or unhealthy")
	
	// Small backoff before restart attempt
	time.Sleep(RestartBackoffDelay)
	
	// Check context before attempting restart (supervisor may have been stopped)
	select {
	case <-s.ctx.Done():
		log.Debug().Msg("Supervisor stopped during restart backoff, aborting restart")
		return
	default:
	}
	
	log.Info().Msg("Attempting to restart Temporal...")
	
	// Use the idempotent Start() method which handles:
	// - Cleanup of stale processes
	// - Reusing healthy instances
	// - Starting new instance if needed
	if err := s.manager.Start(); err != nil {
		log.Error().
			Err(err).
			Msg("Failed to restart Temporal - will retry on next health check")
		return
	}
	
	log.Info().Msg("Temporal restarted successfully")
}

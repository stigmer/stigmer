package health

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Component represents a monitored component with health checks
type Component struct {
	// Name of the component (e.g., "stigmer-server")
	Name string

	// Type of component
	Type ComponentType

	// Health probes
	StartupProbe   *HealthProbe
	LivenessProbe  *HealthProbe
	ReadinessProbe *HealthProbe

	// Restart configuration
	RestartConfig RestartConfig

	// Current health status
	Health ComponentHealth

	// Restart function to call when component needs restart
	// Should return error if restart fails
	RestartFunc func(ctx context.Context) error

	// Stop function to call when component should be stopped
	StopFunc func(ctx context.Context) error

	// Mutex for thread-safe access to health status
	mu sync.RWMutex

	// Internal state
	startupComplete bool
	restartHistory  []time.Time // Timestamps of recent restarts
}

// NewComponent creates a new monitored component
func NewComponent(name string, componentType ComponentType) *Component {
	return &Component{
		Name:          name,
		Type:          componentType,
		RestartConfig: DefaultRestartConfig(),
		Health: ComponentHealth{
			State:     StateStopped,
			StartTime: time.Time{},
		},
		restartHistory: make([]time.Time, 0),
	}
}

// Start marks the component as started and begins health monitoring
func (c *Component) Start() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.Health.State = StateStarting
	c.Health.StartTime = time.Now()
	c.startupComplete = false

	log.Info().
		Str("component", c.Name).
		Msg("Component started, health monitoring active")
}

// Stop marks the component as stopped
func (c *Component) Stop(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	log.Info().
		Str("component", c.Name).
		Msg("Stopping component")

	c.Health.State = StateStopped

	if c.StopFunc != nil {
		return c.StopFunc(ctx)
	}

	return nil
}

// RunHealthCheck executes the appropriate health check based on component state
func (c *Component) RunHealthCheck(ctx context.Context) *ProbeResult {
	c.mu.RLock()
	state := c.Health.State
	startupComplete := c.startupComplete
	c.mu.RUnlock()

	// Don't check stopped or failed components
	if state == StateStopped || state == StateFailed {
		return nil
	}

	// If still starting up, run startup probe
	if !startupComplete && c.StartupProbe != nil {
		result := c.executeProbe(ctx, c.StartupProbe)
		c.processProbeResult(result, true)
		return result
	}

	// Run liveness probe (critical - determines if restart needed)
	if c.LivenessProbe != nil {
		result := c.executeProbe(ctx, c.LivenessProbe)
		c.processProbeResult(result, false)
		return result
	}

	return nil
}

// executeProbe runs a health probe with timeout
func (c *Component) executeProbe(parentCtx context.Context, probe *HealthProbe) *ProbeResult {
	start := time.Now()

	// Create timeout context
	ctx, cancel := context.WithTimeout(parentCtx, probe.Timeout)
	defer cancel()

	// Execute probe
	err := probe.Check(ctx)

	result := &ProbeResult{
		Success:   err == nil,
		Error:     err,
		Timestamp: start,
		Duration:  time.Since(start),
	}

	return result
}

// processProbeResult updates component health based on probe result
func (c *Component) processProbeResult(result *ProbeResult, isStartup bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.Health.LastHealthCheck = result.Timestamp

	if result.Success {
		// Success - increment success counter, reset failure counter
		c.Health.ConsecutiveSuccesses++
		c.Health.ConsecutiveFailures = 0
		c.Health.LastError = nil

		// If this was startup probe, mark startup complete
		if isStartup && c.StartupProbe != nil {
			if c.Health.ConsecutiveSuccesses >= c.StartupProbe.SuccessThreshold {
				c.startupComplete = true
				c.Health.State = StateRunning
				log.Info().
					Str("component", c.Name).
					Dur("duration", time.Since(c.Health.StartTime)).
					Msg("Component startup complete")
			}
		}

		// If was unhealthy, mark as running again
		if c.Health.State == StateUnhealthy && !isStartup {
			if c.LivenessProbe != nil && c.Health.ConsecutiveSuccesses >= c.LivenessProbe.SuccessThreshold {
				c.Health.State = StateRunning
				log.Info().
					Str("component", c.Name).
					Msg("Component recovered to healthy state")
			}
		}

	} else {
		// Failure - increment failure counter, reset success counter
		c.Health.ConsecutiveFailures++
		c.Health.ConsecutiveSuccesses = 0
		c.Health.LastError = result.Error

		log.Warn().
			Str("component", c.Name).
			Err(result.Error).
			Int("consecutive_failures", c.Health.ConsecutiveFailures).
			Msg("Health check failed")

		// Check if we've exceeded failure threshold
		var threshold int
		if isStartup && c.StartupProbe != nil {
			threshold = c.StartupProbe.FailureThreshold
		} else if c.LivenessProbe != nil {
			threshold = c.LivenessProbe.FailureThreshold
		}

		if c.Health.ConsecutiveFailures >= threshold {
			c.Health.State = StateUnhealthy
			log.Error().
				Str("component", c.Name).
				Int("failures", c.Health.ConsecutiveFailures).
				Msg("Component marked unhealthy")
		}
	}
}

// NeedsRestart returns true if the component should be restarted
func (c *Component) NeedsRestart() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Only restart if unhealthy and policy allows
	if c.Health.State != StateUnhealthy {
		return false
	}

	if c.RestartConfig.Policy == RestartPolicyNever {
		return false
	}

	// Check if we've exceeded restart limits
	if c.hasExceededRestartLimit() {
		return false
	}

	return true
}

// hasExceededRestartLimit checks if restart limit has been exceeded
// Must be called with lock held
func (c *Component) hasExceededRestartLimit() bool {
	// Clean up old restart history outside window
	cutoff := time.Now().Add(-c.RestartConfig.RestartWindow)
	validRestarts := make([]time.Time, 0)
	for _, t := range c.restartHistory {
		if t.After(cutoff) {
			validRestarts = append(validRestarts, t)
		}
	}
	c.restartHistory = validRestarts

	// Check if we've hit the limit
	return len(c.restartHistory) >= c.RestartConfig.MaxRestarts
}

// CalculateBackoff calculates the backoff duration before next restart
func (c *Component) CalculateBackoff() time.Duration {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if len(c.restartHistory) == 0 {
		return c.RestartConfig.InitialBackoff
	}

	// Exponential backoff: initialBackoff * (multiplier ^ restartCount)
	backoff := c.RestartConfig.InitialBackoff
	for i := 1; i < len(c.restartHistory); i++ {
		backoff = time.Duration(float64(backoff) * c.RestartConfig.BackoffMultiplier)
		if backoff > c.RestartConfig.MaxBackoff {
			return c.RestartConfig.MaxBackoff
		}
	}

	return backoff
}

// Restart attempts to restart the component
func (c *Component) Restart(ctx context.Context) error {
	c.mu.Lock()

	// Check if we've exceeded restart limits
	if c.hasExceededRestartLimit() {
		c.Health.State = StateFailed
		c.mu.Unlock()

		log.Error().
			Str("component", c.Name).
			Int("max_restarts", c.RestartConfig.MaxRestarts).
			Dur("window", c.RestartConfig.RestartWindow).
			Msg("Component has exceeded maximum restart limit")

		return fmt.Errorf("component %s exceeded restart limit (%d in %s)",
			c.Name, c.RestartConfig.MaxRestarts, c.RestartConfig.RestartWindow)
	}

	c.Health.State = StateRestarting
	c.Health.LastRestart = time.Now()
	c.restartHistory = append(c.restartHistory, time.Now())
	c.Health.RestartCount++

	restartCount := c.Health.RestartCount
	c.mu.Unlock()

	log.Info().
		Str("component", c.Name).
		Int("restart_count", restartCount).
		Int("max_restarts", c.RestartConfig.MaxRestarts).
		Msg("Restarting component")

	// Execute restart function
	if c.RestartFunc == nil {
		return fmt.Errorf("component %s has no restart function", c.Name)
	}

	if err := c.RestartFunc(ctx); err != nil {
		c.mu.Lock()
		c.Health.State = StateFailed
		c.mu.Unlock()

		log.Error().
			Str("component", c.Name).
			Err(err).
			Msg("Failed to restart component")

		return err
	}

	// Reset health state
	c.mu.Lock()
	c.Health.State = StateStarting
	c.Health.StartTime = time.Now()
	c.Health.ConsecutiveFailures = 0
	c.Health.ConsecutiveSuccesses = 0
	c.startupComplete = false
	c.mu.Unlock()

	log.Info().
		Str("component", c.Name).
		Msg("Component restarted successfully")

	return nil
}

// GetUptime returns how long the component has been running
func (c *Component) GetUptime() time.Duration {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.Health.StartTime.IsZero() {
		return 0
	}

	return time.Since(c.Health.StartTime)
}

// GetHealth returns a copy of the current health status
func (c *Component) GetHealth() ComponentHealth {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.Health
}

// GetState returns the current component state
func (c *Component) GetState() ComponentState {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.Health.State
}

// IsHealthy returns true if the component is in a healthy state
func (c *Component) IsHealthy() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.Health.State == StateRunning || c.Health.State == StateStarting
}

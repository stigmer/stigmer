package health

import (
	"context"
	"time"
)

// ProbeType defines the type of health probe
// Inspired by Kubernetes health probe model
type ProbeType string

const (
	// ProbeTypeStartup checks if the component has started successfully
	// Used to give slow-starting components time to initialize
	// Failure delays liveness checks until startup succeeds
	ProbeTypeStartup ProbeType = "startup"

	// ProbeTypeLiveness checks if the component is alive and healthy
	// Used to detect if a component has crashed or become unresponsive
	// Failure triggers component restart
	ProbeTypeLiveness ProbeType = "liveness"

	// ProbeTypeReadiness checks if the component is ready to handle work
	// Used to determine if the component should receive traffic/tasks
	// Failure doesn't trigger restart, just marks component as not ready
	ProbeTypeReadiness ProbeType = "readiness"
)

// ComponentType identifies the type of component being monitored
type ComponentType string

const (
	ComponentTypeStigmerServer  ComponentType = "stigmer-server"
	ComponentTypeWorkflowRunner ComponentType = "workflow-runner"
	ComponentTypeAgentRunner    ComponentType = "agent-runner"
	ComponentTypeTemporal       ComponentType = "temporal"
)

// ComponentState represents the current state of a component
type ComponentState string

const (
	// StateStarting means the component is starting up
	StateStarting ComponentState = "starting"

	// StateRunning means the component is running and healthy
	StateRunning ComponentState = "running"

	// StateUnhealthy means the component failed health checks
	StateUnhealthy ComponentState = "unhealthy"

	// StateRestarting means the component is being restarted
	StateRestarting ComponentState = "restarting"

	// StateStopped means the component is stopped
	StateStopped ComponentState = "stopped"

	// StateFailed means the component has exceeded restart limits
	StateFailed ComponentState = "failed"
)

// RestartPolicy defines when and how a component should be restarted
type RestartPolicy string

const (
	// RestartPolicyAlways always restarts the component on failure (default)
	RestartPolicyAlways RestartPolicy = "always"

	// RestartPolicyOnFailure only restarts if the component exits with error
	RestartPolicyOnFailure RestartPolicy = "on-failure"

	// RestartPolicyNever never restarts the component
	RestartPolicyNever RestartPolicy = "never"
)

// HealthProbe defines a health check for a component
type HealthProbe struct {
	// Type of probe (startup, liveness, readiness)
	Type ProbeType

	// Check function to execute
	// Returns nil if healthy, error if unhealthy
	Check func(ctx context.Context) error

	// Interval between checks
	Interval time.Duration

	// Timeout for each check
	Timeout time.Duration

	// FailureThreshold is number of consecutive failures before marking unhealthy
	// For liveness probes, triggers restart after this many failures
	FailureThreshold int

	// SuccessThreshold is number of consecutive successes to mark healthy
	// Useful for readiness probes to wait for stability
	SuccessThreshold int
}

// ProbeResult tracks the result of a health probe execution
type ProbeResult struct {
	// Success indicates if the probe passed
	Success bool

	// Error contains the failure reason if probe failed
	Error error

	// Timestamp when the probe was executed
	Timestamp time.Time

	// Duration how long the probe took
	Duration time.Duration
}

// ComponentHealth tracks the health status of a component
type ComponentHealth struct {
	// State of the component
	State ComponentState

	// StartTime when the component started
	StartTime time.Time

	// LastHealthCheck when the last health check ran
	LastHealthCheck time.Time

	// ConsecutiveFailures count of consecutive health check failures
	ConsecutiveFailures int

	// ConsecutiveSuccesses count of consecutive health check successes
	ConsecutiveSuccesses int

	// RestartCount total number of restarts
	RestartCount int

	// LastRestart when the component was last restarted
	LastRestart time.Time

	// LastError from health check
	LastError error
}

// RestartConfig configures restart behavior
type RestartConfig struct {
	// Policy determines when to restart
	Policy RestartPolicy

	// MaxRestarts maximum number of restarts within window
	// Component enters failed state after exceeding this
	MaxRestarts int

	// RestartWindow time window for counting restarts
	// Example: max 10 restarts in 10 minutes
	RestartWindow time.Duration

	// MinUptime minimum time component must run before restart is considered successful
	// If component crashes before this, restart counter doesn't reset
	MinUptime time.Duration

	// InitialBackoff starting backoff delay after first restart
	InitialBackoff time.Duration

	// MaxBackoff maximum backoff delay
	MaxBackoff time.Duration

	// BackoffMultiplier multiplier for exponential backoff
	// Example: 2.0 means 1s, 2s, 4s, 8s...
	BackoffMultiplier float64
}

// DefaultRestartConfig returns sensible default restart configuration
func DefaultRestartConfig() RestartConfig {
	return RestartConfig{
		Policy:            RestartPolicyAlways,
		MaxRestarts:       10,
		RestartWindow:     10 * time.Minute,
		MinUptime:         10 * time.Second,
		InitialBackoff:    1 * time.Second,
		MaxBackoff:        60 * time.Second,
		BackoffMultiplier: 2.0,
	}
}

// DefaultHealthProbeConfig returns default health probe configuration
func DefaultHealthProbeConfig(probeType ProbeType) HealthProbe {
	switch probeType {
	case ProbeTypeStartup:
		// Startup probes run more frequently with higher tolerance
		return HealthProbe{
			Type:             ProbeTypeStartup,
			Interval:         1 * time.Second,
			Timeout:          5 * time.Second,
			FailureThreshold: 30, // Allow 30 seconds to start
			SuccessThreshold: 1,
		}

	case ProbeTypeLiveness:
		// Liveness probes are critical - trigger restart on failure
		return HealthProbe{
			Type:             ProbeTypeLiveness,
			Interval:         10 * time.Second,
			Timeout:          3 * time.Second,
			FailureThreshold: 3, // Restart after 3 consecutive failures (30 seconds)
			SuccessThreshold: 1,
		}

	case ProbeTypeReadiness:
		// Readiness probes determine if component can handle work
		return HealthProbe{
			Type:             ProbeTypeReadiness,
			Interval:         5 * time.Second,
			Timeout:          2 * time.Second,
			FailureThreshold: 3,
			SuccessThreshold: 2, // Need 2 successes to mark ready
		}

	default:
		// Fallback to liveness defaults
		return HealthProbe{
			Type:             probeType,
			Interval:         10 * time.Second,
			Timeout:          3 * time.Second,
			FailureThreshold: 3,
			SuccessThreshold: 1,
		}
	}
}

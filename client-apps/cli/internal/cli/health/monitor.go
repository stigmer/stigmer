package health

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Monitor manages health checking for multiple components
type Monitor struct {
	components map[string]*Component
	mu         sync.RWMutex

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// Default check interval
	checkInterval time.Duration
}

// NewMonitor creates a new health monitor
func NewMonitor() *Monitor {
	return &Monitor{
		components:    make(map[string]*Component),
		checkInterval: 10 * time.Second,
	}
}

// RegisterComponent adds a component to be monitored
func (m *Monitor) RegisterComponent(component *Component) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.components[component.Name] = component

	log.Info().
		Str("component", component.Name).
		Str("type", string(component.Type)).
		Msg("Registered component for health monitoring")
}

// UnregisterComponent removes a component from monitoring
func (m *Monitor) UnregisterComponent(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.components, name)

	log.Info().
		Str("component", name).
		Msg("Unregistered component from health monitoring")
}

// GetComponent returns a component by name
func (m *Monitor) GetComponent(name string) *Component {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.components[name]
}

// GetAllComponents returns all registered components
func (m *Monitor) GetAllComponents() []*Component {
	m.mu.RLock()
	defer m.mu.RUnlock()

	components := make([]*Component, 0, len(m.components))
	for _, c := range m.components {
		components = append(components, c)
	}

	return components
}

// Start begins health monitoring for all registered components
func (m *Monitor) Start(ctx context.Context) {
	m.ctx, m.cancel = context.WithCancel(ctx)

	log.Info().
		Int("component_count", len(m.components)).
		Dur("interval", m.checkInterval).
		Msg("Starting health monitor")

	m.wg.Add(1)
	go m.watchdog()
}

// Stop stops health monitoring
func (m *Monitor) Stop() {
	if m.cancel != nil {
		m.cancel()
	}

	m.wg.Wait()

	log.Info().Msg("Health monitor stopped")
}

// watchdog is the main monitoring loop
func (m *Monitor) watchdog() {
	defer m.wg.Done()

	ticker := time.NewTicker(m.checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			log.Debug().Msg("Watchdog stopping")
			return

		case <-ticker.C:
			m.checkAllComponents()
		}
	}
}

// checkAllComponents runs health checks on all components
func (m *Monitor) checkAllComponents() {
	m.mu.RLock()
	components := make([]*Component, 0, len(m.components))
	for _, c := range m.components {
		components = append(components, c)
	}
	m.mu.RUnlock()

	// Check each component (in parallel for efficiency)
	var wg sync.WaitGroup
	for _, component := range components {
		wg.Add(1)
		go func(c *Component) {
			defer wg.Done()
			m.checkComponent(c)
		}(component)
	}
	wg.Wait()
}

// checkComponent checks a single component and handles restart if needed
func (m *Monitor) checkComponent(component *Component) {
	// Run health check
	result := component.RunHealthCheck(m.ctx)

	// Log result (debug level for successes, warning for failures)
	if result != nil {
		if result.Success {
			log.Debug().
				Str("component", component.Name).
				Dur("duration", result.Duration).
				Msg("Health check passed")
		} else {
			log.Warn().
				Str("component", component.Name).
				Err(result.Error).
				Dur("duration", result.Duration).
				Msg("Health check failed")
		}
	}

	// Check if component needs restart
	if component.NeedsRestart() {
		m.handleRestart(component)
	}
}

// handleRestart manages component restart with backoff
func (m *Monitor) handleRestart(component *Component) {
	// Calculate backoff delay
	backoff := component.CalculateBackoff()

	log.Info().
		Str("component", component.Name).
		Dur("backoff", backoff).
		Msg("Component unhealthy, restarting after backoff")

	// Wait for backoff period (respecting context cancellation)
	select {
	case <-time.After(backoff):
		// Backoff complete, proceed with restart
	case <-m.ctx.Done():
		// Monitor stopped during backoff
		return
	}

	// Attempt restart
	ctx, cancel := context.WithTimeout(m.ctx, 30*time.Second)
	defer cancel()

	if err := component.Restart(ctx); err != nil {
		log.Error().
			Str("component", component.Name).
			Err(err).
			Msg("Failed to restart component")

		// Check if component entered failed state
		if component.GetState() == StateFailed {
			log.Error().
				Str("component", component.Name).
				Msg("Component has failed permanently - manual intervention required")
		}
	} else {
		log.Info().
			Str("component", component.Name).
			Msg("Component restart successful")
	}
}

// GetHealthSummary returns a summary of all component health
func (m *Monitor) GetHealthSummary() map[string]ComponentHealth {
	m.mu.RLock()
	defer m.mu.RUnlock()

	summary := make(map[string]ComponentHealth)
	for name, component := range m.components {
		summary[name] = component.GetHealth()
	}

	return summary
}

// IsAllHealthy returns true if all components are healthy
func (m *Monitor) IsAllHealthy() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, component := range m.components {
		if !component.IsHealthy() {
			return false
		}
	}

	return true
}

// Package temporal is the OSS schedule clock (T04 slice 3): per-resource
// Temporal Schedules, the tick workflow that revalidates and fires, the
// run tracking that feeds the failure streak, and the reconciliation pass
// that converges rows and artifacts.
//
// The BEHAVIOR contract mirrors the cloud edition exactly (project
// DD-010/DD-012/DD-013; the conformance firing suite asserts the shared
// contract on both editions). The MECHANISM diverges deliberately where
// the editions differ — every divergence is recorded in project DD-015:
// status writes ride store.UpdateResource (SQLite stores one protobuf
// blob; there is no leaf patch), arming never refuses (Temporal may
// legitimately be absent here), reconciliation runs on every Temporal
// (re)connect (an OSS dev-server restart destroys every artifact), and
// the clock logs structured events where cloud emits metrics.
package temporal

import (
	"os"
	"strconv"
)

// Config holds the schedule clock's configuration.
//
// Environment variables deliberately share the STIGMER_SCHEDULES_* names
// with the cloud edition, so test harnesses and runbooks use one
// vocabulary. There is deliberately NO interval-floor knob: the floor is
// a platform guardrail for a shared metered system, enforced by cloud's
// pre-persist probe; OSS is one user on their own machine and has no
// probe (DD-015 D-A) — a present-but-ignored knob would be a lie.
type Config struct {
	// StigmerQueue is the task queue for the tick workflow and its
	// activities. Dedicated (not the agent-execution queue) so a
	// spanning tick can never starve agent executions.
	// Default: schedule_stigmer
	StigmerQueue string

	// CatchupWindowMinutes is baked into every artifact's policy: how
	// far back Temporal fires missed ticks after downtime (the laptop
	// that slept through 9am). Default: 60.
	CatchupWindowMinutes int

	// TickRunTimeoutHours is the artifact's baked workflow run timeout —
	// a backstop, not policy (the tracking budget is the policy).
	// Default: 24.
	TickRunTimeoutHours int

	// MaxConsecutiveFailures is the auto-pause threshold (DD-008 D7).
	// Default: 5.
	MaxConsecutiveFailures int

	// RunTrackingTimeoutMinutes is one fire's tracking budget — under
	// overlap SKIP, literally the maximum time one hung run may silence
	// a schedule. Clamped at fire time to at least 1 minute and at least
	// one hour inside the baked run timeout. Default: 60.
	RunTrackingTimeoutMinutes int

	// ReconciliationEnabled gates the periodic convergence pass (the
	// reconnect-triggered pass always runs — it is correctness, not
	// hygiene, on an ephemeral dev server). Default: true.
	ReconciliationEnabled bool

	// ReconciliationIntervalMinutes is the periodic pass cadence.
	// Default: 5.
	ReconciliationIntervalMinutes int

	// ExecutionProfileMaxToolRounds bounds each scheduled run's tool
	// rounds (0 disables the bound). An unattended runaway burns the
	// user's own API budget with nobody watching — worse than an
	// interactive one. Default: 20 (the cloud profile's value).
	ExecutionProfileMaxToolRounds int

	// ExecutionProfileMaxCostUsd bounds each scheduled run's spend,
	// enforced by the shared runner (0 disables). Default: 1.00.
	ExecutionProfileMaxCostUsd float64

	// RunHistoryRetentionDays bounds the fire ledger (project DD-017
	// D-7): rows recorded earlier than this are pruned by the
	// reconciliation pass. Default: 90 (a quarter of monthly reminder
	// cycles — run history is a product surface, not delivery plumbing).
	RunHistoryRetentionDays int
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() *Config {
	return &Config{
		StigmerQueue:                  getEnv("TEMPORAL_SCHEDULE_STIGMER_TASK_QUEUE", "schedule_stigmer"),
		CatchupWindowMinutes:          getEnvInt("STIGMER_SCHEDULES_CATCHUP_WINDOW_MINUTES", 60),
		TickRunTimeoutHours:           getEnvInt("STIGMER_SCHEDULES_TICK_RUN_TIMEOUT_HOURS", 24),
		MaxConsecutiveFailures:        getEnvInt("STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES", 5),
		RunTrackingTimeoutMinutes:     getEnvInt("STIGMER_SCHEDULES_RUN_TRACKING_TIMEOUT_MINUTES", 60),
		ReconciliationEnabled:         getEnvBool("STIGMER_SCHEDULES_RECONCILIATION_ENABLED", true),
		ReconciliationIntervalMinutes: getEnvInt("STIGMER_SCHEDULES_RECONCILIATION_INTERVAL_MINUTES", 5),
		ExecutionProfileMaxToolRounds: getEnvInt("STIGMER_SCHEDULES_EXECUTION_PROFILE_MAX_TOOL_ROUNDS", 20),
		ExecutionProfileMaxCostUsd:    getEnvFloat("STIGMER_SCHEDULES_EXECUTION_PROFILE_MAX_COST_USD", 1.00),
		RunHistoryRetentionDays:       getEnvInt("STIGMER_SCHEDULES_RUN_HISTORY_RETENTION_DAYS", 90),
	}
}

// ResolvedRunTrackingTimeoutMinutes clamps the tracking budget to at
// least 1 minute and at least one hour inside the baked artifact run
// timeout — the cloud edition's exact clamp, so a misconfigured budget
// cannot outlive the tick that carries it.
func (c *Config) ResolvedRunTrackingTimeoutMinutes() int {
	ceiling := (c.TickRunTimeoutHours - 1) * 60
	if ceiling < 1 {
		ceiling = 1
	}
	resolved := c.RunTrackingTimeoutMinutes
	if resolved > ceiling {
		resolved = ceiling
	}
	if resolved < 1 {
		resolved = 1
	}
	return resolved
}

// ResolvedMaxConsecutiveFailures floors the pause threshold at 1 — a
// zero/negative threshold would pause on configuration, not on failure.
func (c *Config) ResolvedMaxConsecutiveFailures() int {
	if c.MaxConsecutiveFailures < 1 {
		return 1
	}
	return c.MaxConsecutiveFailures
}

// ResolvedRunHistoryRetentionDays floors the fire-ledger retention at 1
// day — zero/negative would prune history as it lands.
func (c *Config) ResolvedRunHistoryRetentionDays() int {
	if c.RunHistoryRetentionDays < 1 {
		return 1
	}
	return c.RunHistoryRetentionDays
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.ParseBool(value); err == nil {
			return parsed
		}
	}
	return defaultValue
}

func getEnvFloat(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.ParseFloat(value, 64); err == nil {
			return parsed
		}
	}
	return defaultValue
}

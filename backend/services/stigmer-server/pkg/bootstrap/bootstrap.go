// Package bootstrap provides seedpack bootstrap functionality for the Stigmer server.
//
// The bootstrap process runs on server startup to ensure essential skills and system
// agents are available. It uses the vendored seedpack (embedded in the binary) to
// provide offline-first operation.
//
// Design principles:
//   - Idempotent: Safe to run multiple times (uses content digests for change detection)
//   - Offline-first: All resources are embedded in the binary, no network required
//   - Graceful degradation: Server starts even if bootstrap fails (logs warnings)
//   - Versioned: Tracks seedpack version to detect upgrades
//
// Bootstrap state is persisted in SQLite via the bootstrap_state table:
//   - "seedpack_version": Current seedpack version applied
//   - "bootstrap_status": Overall status (pending, in_progress, completed, failed)
//   - "skill:<name>": Per-skill state with artifact digest
//   - "agent:<name>": Per-agent state with content hash
package bootstrap

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/backend/libs/go/seedpack"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// Bootstrap status constants
const (
	StatusPending    = "pending"
	StatusInProgress = "in_progress"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
)

// State key constants for bootstrap_state table
const (
	KeySeedpackVersion = "seedpack_version"
	KeyBootstrapStatus = "bootstrap_status"
	KeySkillPrefix     = "skill:"
	KeyAgentPrefix     = "agent:"
	KeyAppliedPrefix   = "applied:"
)

// SkillClient defines the interface for pushing skills.
// This allows for dependency injection and testing.
type SkillClient interface {
	Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.Skill, error)
}

// AgentClient defines the interface for applying agents.
// This allows for dependency injection and testing.
type AgentClient interface {
	Apply(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error)
}

// Bootstrapper handles seedpack bootstrap operations.
type Bootstrapper struct {
	store       *sqlite.Store
	skillClient SkillClient
	agentClient AgentClient
	// org is the organization to bootstrap skills/agents into (system org)
	org string
}

// NewBootstrapper creates a new bootstrapper with the given dependencies.
func NewBootstrapper(store *sqlite.Store, skillClient SkillClient, agentClient AgentClient) *Bootstrapper {
	return &Bootstrapper{
		store:       store,
		skillClient: skillClient,
		agentClient: agentClient,
		org:         "stigmer", // System organization for bootstrapped resources
	}
}

// Run executes the bootstrap process.
// It returns an error only if the bootstrap fails in a way that should prevent
// server startup. In degraded mode, it logs warnings and returns nil.
//
// The bootstrap process:
// 1. Loads the seedpack manifest
// 2. Checks if bootstrap is needed (version comparison)
// 3. Applies skills via Push API
// 4. Applies agents via Apply API
// 5. Updates bootstrap state
func (b *Bootstrapper) Run(ctx context.Context) error {
	log.Info().Msg("Starting seedpack bootstrap")

	// Mark bootstrap as in progress
	if err := b.store.SetBootstrapState(ctx, KeyBootstrapStatus, StatusInProgress); err != nil {
		log.Warn().Err(err).Msg("Failed to set bootstrap status to in_progress")
		// Continue anyway - state tracking is not critical for bootstrap
	}

	// Load manifest
	manifest, err := seedpack.LoadManifest()
	if err != nil {
		log.Error().Err(err).Msg("Failed to load seedpack manifest")
		b.markFailed(ctx, "failed to load manifest: "+err.Error())
		return nil // Degraded mode - don't fail server startup
	}

	log.Info().
		Str("version", manifest.Version).
		Int("skills", len(manifest.Skills)).
		Int("agents", len(manifest.SystemAgents)).
		Msg("Loaded seedpack manifest")

	// Check if bootstrap is needed
	currentVersion, err := b.store.GetBootstrapState(ctx, KeySeedpackVersion)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get current seedpack version")
		// Continue - assume bootstrap is needed
	}

	if currentVersion == manifest.Version {
		// Check if bootstrap was actually completed
		status, _ := b.store.GetBootstrapState(ctx, KeyBootstrapStatus)
		if status == StatusCompleted {
			log.Info().
				Str("version", manifest.Version).
				Msg("Seedpack already bootstrapped, skipping")
			return nil
		}
		log.Info().
			Str("version", manifest.Version).
			Str("status", status).
			Msg("Seedpack version matches but bootstrap incomplete, re-running")
	} else if currentVersion != "" {
		log.Info().
			Str("current", currentVersion).
			Str("new", manifest.Version).
			Msg("Seedpack version upgrade detected")
	}

	// Bootstrap skills
	skillErrors := 0
	for _, skillEntry := range manifest.Skills {
		if err := b.bootstrapSkill(ctx, &skillEntry); err != nil {
			log.Error().
				Err(err).
				Str("skill", skillEntry.Name).
				Msg("Failed to bootstrap skill")
			skillErrors++
		}
	}

	// Bootstrap agents
	agentErrors := 0
	for _, agentEntry := range manifest.SystemAgents {
		if err := b.bootstrapAgent(ctx, &agentEntry); err != nil {
			log.Error().
				Err(err).
				Str("agent", agentEntry.Name).
				Msg("Failed to bootstrap agent")
			agentErrors++
		}
	}

	// Update final status
	if skillErrors > 0 || agentErrors > 0 {
		log.Warn().
			Int("skill_errors", skillErrors).
			Int("agent_errors", agentErrors).
			Msg("Bootstrap completed with errors (degraded mode)")
		b.markFailed(ctx, fmt.Sprintf("partial failure: %d skill errors, %d agent errors", skillErrors, agentErrors))
		return nil // Degraded mode
	}

	// Mark successful
	if err := b.store.SetBootstrapState(ctx, KeySeedpackVersion, manifest.Version); err != nil {
		log.Warn().Err(err).Msg("Failed to set seedpack version")
	}
	if err := b.store.SetBootstrapState(ctx, KeyBootstrapStatus, StatusCompleted); err != nil {
		log.Warn().Err(err).Msg("Failed to set bootstrap status to completed")
	}

	log.Info().
		Str("version", manifest.Version).
		Int("skills", len(manifest.Skills)).
		Int("agents", len(manifest.SystemAgents)).
		Msg("Seedpack bootstrap completed successfully")

	return nil
}

// bootstrapSkill applies a single skill from the seedpack.
func (b *Bootstrapper) bootstrapSkill(ctx context.Context, entry *seedpack.SkillEntry) error {
	log.Info().
		Str("skill", entry.Name).
		Str("artifact_path", entry.ArtifactPath).
		Msg("Bootstrapping skill")

	// Check if already applied with same digest
	stateKey := KeySkillPrefix + entry.Name
	currentState, err := b.store.GetBootstrapState(ctx, stateKey)
	if err != nil {
		log.Warn().Err(err).Str("skill", entry.Name).Msg("Failed to get skill state")
		// Continue anyway
	}

	expectedState := KeyAppliedPrefix + entry.ArtifactDigest
	if currentState == expectedState {
		log.Debug().
			Str("skill", entry.Name).
			Str("digest", entry.ArtifactDigest).
			Msg("Skill already applied with same digest, skipping")
		return nil
	}

	// Load pre-built ZIP artifact
	artifactData, err := seedpack.LoadSkillArtifact(entry.ArtifactPath)
	if err != nil {
		return fmt.Errorf("load artifact: %w", err)
	}

	// Verify artifact digest
	hash := sha256.Sum256(artifactData)
	actualDigest := "sha256:" + hex.EncodeToString(hash[:])
	if actualDigest != entry.ArtifactDigest {
		return fmt.Errorf("artifact digest mismatch: expected %s, got %s", entry.ArtifactDigest, actualDigest)
	}

	// Push skill via API
	req := &skillv1.PushSkillRequest{
		Org:      b.org,
		Artifact: artifactData,
		Tag:      "system", // Tag system skills
	}

	skill, err := b.skillClient.Push(ctx, req)
	if err != nil {
		return fmt.Errorf("push skill: %w", err)
	}

	// Record state
	if err := b.store.SetBootstrapState(ctx, stateKey, expectedState); err != nil {
		log.Warn().Err(err).Str("skill", entry.Name).Msg("Failed to record skill state")
	}

	log.Info().
		Str("skill", entry.Name).
		Str("id", skill.GetMetadata().GetId()).
		Str("version_hash", skill.GetStatus().GetVersionHash()).
		Msg("Skill bootstrapped successfully")

	return nil
}

// bootstrapAgent applies a single system agent from the seedpack.
func (b *Bootstrapper) bootstrapAgent(ctx context.Context, entry *seedpack.AgentEntry) error {
	log.Info().
		Str("agent", entry.Name).
		Str("path", entry.Path).
		Msg("Bootstrapping agent")

	// Load and parse agent YAML
	agent, err := seedpack.LoadAgentYAML(entry.Path)
	if err != nil {
		return fmt.Errorf("load agent YAML: %w", err)
	}

	// Calculate content hash for state tracking
	// Use a simple hash of the agent name and spec for change detection
	contentHash := calculateAgentHash(agent)

	// Check if already applied with same hash
	stateKey := KeyAgentPrefix + entry.Name
	currentState, err := b.store.GetBootstrapState(ctx, stateKey)
	if err != nil {
		log.Warn().Err(err).Str("agent", entry.Name).Msg("Failed to get agent state")
		// Continue anyway
	}

	expectedState := KeyAppliedPrefix + contentHash
	if currentState == expectedState {
		log.Debug().
			Str("agent", entry.Name).
			Str("hash", contentHash).
			Msg("Agent already applied with same hash, skipping")
		return nil
	}

	// Set required metadata for the system agent
	if agent.Metadata == nil {
		return fmt.Errorf("agent %s has no metadata", entry.Name)
	}
	agent.Metadata.Org = b.org

	// Apply agent via API (idempotent create/update)
	applied, err := b.agentClient.Apply(ctx, agent)
	if err != nil {
		return fmt.Errorf("apply agent: %w", err)
	}

	// Record state
	if err := b.store.SetBootstrapState(ctx, stateKey, expectedState); err != nil {
		log.Warn().Err(err).Str("agent", entry.Name).Msg("Failed to record agent state")
	}

	log.Info().
		Str("agent", entry.Name).
		Str("id", applied.GetMetadata().GetId()).
		Msg("Agent bootstrapped successfully")

	return nil
}

// markFailed records bootstrap failure in state.
func (b *Bootstrapper) markFailed(ctx context.Context, reason string) {
	if err := b.store.SetBootstrapState(ctx, KeyBootstrapStatus, StatusFailed); err != nil {
		log.Warn().Err(err).Msg("Failed to set bootstrap status to failed")
	}
	log.Warn().Str("reason", reason).Msg("Bootstrap failed (server will continue in degraded mode)")
}

// calculateAgentHash generates a content hash for an agent based on its spec.
// This is used for change detection during bootstrap.
func calculateAgentHash(agent *agentv1.Agent) string {
	// Create a simple hash from key fields
	content := agent.GetMetadata().GetName() +
		agent.GetSpec().GetDescription() +
		agent.GetSpec().GetInstructions()

	// Add skill refs
	for _, ref := range agent.GetSpec().GetSkillRefs() {
		content += ref.GetKind().String() + ref.GetOrg() + ref.GetSlug()
	}

	hash := sha256.Sum256([]byte(content))
	return "sha256:" + hex.EncodeToString(hash[:])[:16] // Short hash for readability
}

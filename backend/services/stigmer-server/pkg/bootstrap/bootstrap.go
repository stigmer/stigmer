// Package bootstrap provides seedpack bootstrap functionality for the Stigmer server.
//
// The bootstrap process runs on server startup to ensure essential skills, system
// agents, and MCP servers are available. It uses the vendored seedpack (embedded
// in the binary) to provide offline-first operation.
//
// Design principles:
//   - Idempotent: Safe to run multiple times (uses content digests for change detection)
//   - Offline-first: All resources are embedded in the binary, no network required
//   - Graceful degradation: Server starts even if bootstrap fails (logs warnings)
//   - Content-addressed: Tracks a content hash over all embedded resources to detect changes
//
// Bootstrap state is persisted in SQLite via the bootstrap_state table:
//   - "seedpack_content_hash": Content hash of the entire seedpack
//   - "bootstrap_status": Overall status (pending, in_progress, completed, failed)
//   - "skill:<name>": Per-skill state with artifact digest
//   - "agent:<name>": Per-agent state with content hash
//   - "mcpserver:<name>": Per-MCP-server state with content hash
package bootstrap

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/seedpack"
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
	KeySeedpackContentHash = "seedpack_content_hash"
	KeyBootstrapStatus     = "bootstrap_status"
	KeySkillPrefix         = "skill:"
	KeyAgentPrefix         = "agent:"
	KeyMcpServerPrefix     = "mcpserver:"
	KeyAppliedPrefix       = "applied:"
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

// McpServerClient defines the interface for applying MCP servers.
// This allows for dependency injection and testing.
type McpServerClient interface {
	Apply(ctx context.Context, mcpServer *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error)
}

// Bootstrapper handles seedpack bootstrap operations.
type Bootstrapper struct {
	store           *sqlite.Store
	skillClient     SkillClient
	agentClient     AgentClient
	mcpServerClient McpServerClient
	// org is the organization to bootstrap resources into (system org)
	org string
}

// NewBootstrapper creates a new bootstrapper with the given dependencies.
func NewBootstrapper(store *sqlite.Store, skillClient SkillClient, agentClient AgentClient, mcpServerClient McpServerClient) *Bootstrapper {
	return &Bootstrapper{
		store:           store,
		skillClient:     skillClient,
		agentClient:     agentClient,
		mcpServerClient: mcpServerClient,
		org:             "local", // Local organization for bootstrapped resources (single-tenant local mode)
	}
}

// Run executes the bootstrap process.
// It returns an error only if the bootstrap fails in a way that should prevent
// server startup. In degraded mode, it logs warnings and returns nil.
//
// The bootstrap process:
// 1. Discovers resources from the embedded seedpack filesystem
// 2. Checks if bootstrap is needed (content hash comparison)
// 3. Applies skills via Push API
// 4. Applies agents via Apply API
// 5. Applies MCP servers via Apply API
// 6. Updates bootstrap state
func (b *Bootstrapper) Run(ctx context.Context) error {
	log.Info().Msg("Starting seedpack bootstrap")

	if err := b.store.SetBootstrapState(ctx, KeyBootstrapStatus, StatusInProgress); err != nil {
		log.Warn().Err(err).Msg("Failed to set bootstrap status to in_progress")
	}

	manifest, err := seedpack.DiscoverManifest()
	if err != nil {
		log.Error().Err(err).Msg("Failed to discover seedpack resources")
		b.markFailed(ctx, "failed to discover seedpack: "+err.Error())
		return nil
	}

	log.Info().
		Str("content_hash", manifest.ContentHash).
		Int("skills", len(manifest.Skills)).
		Int("agents", len(manifest.SystemAgents)).
		Int("mcp_servers", len(manifest.McpServers)).
		Msg("Discovered seedpack resources")

	storedHash, err := b.store.GetBootstrapState(ctx, KeySeedpackContentHash)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get stored seedpack content hash")
	}

	if storedHash == manifest.ContentHash {
		status, _ := b.store.GetBootstrapState(ctx, KeyBootstrapStatus)
		if status == StatusCompleted {
			log.Info().
				Str("content_hash", manifest.ContentHash).
				Msg("Seedpack unchanged, skipping bootstrap")
			return nil
		}
		log.Info().
			Str("content_hash", manifest.ContentHash).
			Str("status", status).
			Msg("Seedpack hash matches but bootstrap incomplete, re-running")
	} else if storedHash != "" {
		log.Info().
			Str("previous", storedHash).
			Str("current", manifest.ContentHash).
			Msg("Seedpack content changed, re-bootstrapping")
	}

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

	mcpServerErrors := 0
	for _, mcpServerEntry := range manifest.McpServers {
		if err := b.bootstrapMcpServer(ctx, &mcpServerEntry); err != nil {
			log.Error().
				Err(err).
				Str("mcp_server", mcpServerEntry.Name).
				Msg("Failed to bootstrap MCP server")
			mcpServerErrors++
		}
	}

	if skillErrors > 0 || agentErrors > 0 || mcpServerErrors > 0 {
		log.Warn().
			Int("skill_errors", skillErrors).
			Int("agent_errors", agentErrors).
			Int("mcp_server_errors", mcpServerErrors).
			Msg("Bootstrap completed with errors (degraded mode)")
		b.markFailed(ctx, fmt.Sprintf("partial failure: %d skill errors, %d agent errors, %d mcp server errors",
			skillErrors, agentErrors, mcpServerErrors))
		return nil
	}

	if err := b.store.SetBootstrapState(ctx, KeySeedpackContentHash, manifest.ContentHash); err != nil {
		log.Warn().Err(err).Msg("Failed to store seedpack content hash")
	}
	if err := b.store.SetBootstrapState(ctx, KeyBootstrapStatus, StatusCompleted); err != nil {
		log.Warn().Err(err).Msg("Failed to set bootstrap status to completed")
	}

	log.Info().
		Str("content_hash", manifest.ContentHash).
		Int("skills", len(manifest.Skills)).
		Int("agents", len(manifest.SystemAgents)).
		Int("mcp_servers", len(manifest.McpServers)).
		Msg("Seedpack bootstrap completed successfully")

	return nil
}

// bootstrapSkill applies a single skill from the seedpack.
func (b *Bootstrapper) bootstrapSkill(ctx context.Context, entry *seedpack.SkillEntry) error {
	log.Info().
		Str("skill", entry.Name).
		Str("path", entry.Path).
		Msg("Bootstrapping skill")

	stateKey := KeySkillPrefix + entry.Name
	currentState, err := b.store.GetBootstrapState(ctx, stateKey)
	if err != nil {
		log.Warn().Err(err).Str("skill", entry.Name).Msg("Failed to get skill state")
	}

	expectedState := KeyAppliedPrefix + entry.ContentDigest
	if currentState == expectedState {
		log.Debug().
			Str("skill", entry.Name).
			Str("digest", entry.ContentDigest).
			Msg("Skill already applied with same content digest, skipping")
		return nil
	}

	zipData, err := seedpack.CreateSkillZIP(entry.Path)
	if err != nil {
		return fmt.Errorf("create skill zip: %w", err)
	}

	req := &skillv1.PushSkillRequest{
		Org:      b.org,
		Artifact: zipData,
		Tag:      "system",
	}

	skill, err := b.skillClient.Push(ctx, req)
	if err != nil {
		return fmt.Errorf("push skill: %w", err)
	}

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

// bootstrapMcpServer applies a single MCP server from the seedpack.
func (b *Bootstrapper) bootstrapMcpServer(ctx context.Context, entry *seedpack.McpServerEntry) error {
	log.Info().
		Str("mcp_server", entry.Name).
		Str("path", entry.Path).
		Msg("Bootstrapping MCP server")

	// Load and parse MCP server YAML
	mcpServer, err := seedpack.LoadMcpServerYAML(entry.Path)
	if err != nil {
		return fmt.Errorf("load MCP server YAML: %w", err)
	}

	// Calculate content hash for state tracking
	contentHash := calculateMcpServerHash(mcpServer)

	// Check if already applied with same hash
	stateKey := KeyMcpServerPrefix + entry.Name
	currentState, err := b.store.GetBootstrapState(ctx, stateKey)
	if err != nil {
		log.Warn().Err(err).Str("mcp_server", entry.Name).Msg("Failed to get MCP server state")
	}

	expectedState := KeyAppliedPrefix + contentHash
	if currentState == expectedState {
		log.Debug().
			Str("mcp_server", entry.Name).
			Str("hash", contentHash).
			Msg("MCP server already applied with same hash, skipping")
		return nil
	}

	// Set required metadata for the system MCP server
	if mcpServer.Metadata == nil {
		return fmt.Errorf("MCP server %s has no metadata", entry.Name)
	}
	mcpServer.Metadata.Org = b.org

	// Apply MCP server via API (idempotent create/update)
	applied, err := b.mcpServerClient.Apply(ctx, mcpServer)
	if err != nil {
		return fmt.Errorf("apply MCP server: %w", err)
	}

	// Record state
	if err := b.store.SetBootstrapState(ctx, stateKey, expectedState); err != nil {
		log.Warn().Err(err).Str("mcp_server", entry.Name).Msg("Failed to record MCP server state")
	}

	log.Info().
		Str("mcp_server", entry.Name).
		Str("id", applied.GetMetadata().GetId()).
		Msg("MCP server bootstrapped successfully")

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

// calculateMcpServerHash generates a content hash for an MCP server based on its spec.
// This is used for change detection during bootstrap.
//
// Hashes selected key fields rather than the entire proto to avoid false positives
// from system-populated fields (id, audit timestamps) that change across restarts.
func calculateMcpServerHash(mcpServer *mcpserverv1.McpServer) string {
	content := mcpServer.GetMetadata().GetName() +
		mcpServer.GetSpec().GetDescription()

	// Include transport configuration
	if stdio := mcpServer.GetSpec().GetStdio(); stdio != nil {
		content += stdio.GetCommand()
		for _, arg := range stdio.GetArgs() {
			content += arg
		}
	}
	if http := mcpServer.GetSpec().GetHttp(); http != nil {
		content += http.GetUrl()
	}

	for _, tag := range mcpServer.GetSpec().GetTags() {
		content += tag
	}

	hash := sha256.Sum256([]byte(content))
	return "sha256:" + hex.EncodeToString(hash[:])[:16]
}

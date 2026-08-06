package harness

import (
	"context"
	"fmt"
	"io"
	"time"
)

// ChannelConversationSeeder writes s_agentic.channel_conversation rows
// directly into app-postgres.
//
// This is the identity-seeder carve-out applied to the conversation
// aggregate: conversation rows are runtime facts created ONLY by customer
// webhook traffic (channel-conversations DD-003 D-d — no RPC writes them
// until T03's reply command lands), so an integration test that needs a
// conversation to exist has no front door to walk through. The table is
// fully relational (plain columns, no proto-JSON document), which keeps the
// storage coupling shallow: the columns seeded here are pinned by the cloud
// repo's AppPostgresBaselineDdlTest.
type ChannelConversationSeeder struct {
	pg *AppPostgresContainer
}

// NewChannelConversationSeeder wraps the harness's app-postgres container.
func NewChannelConversationSeeder(pg *AppPostgresContainer) *ChannelConversationSeeder {
	return &ChannelConversationSeeder{pg: pg}
}

// SeedConversationInput is one conversation row: a customer identity on a
// channel, born in the default agent-control state.
type SeedConversationInput struct {
	// AgentChannelID is the serving AgentChannel's metadata.id.
	AgentChannelID string
	// ConversationKey is the provider conversation key (WhatsApp: wa_id).
	ConversationKey string
	// Org is the channel's org (metadata.org) — the org-wide list's filter.
	Org string
	// DisplayName is the customer's provider profile name; may be empty.
	DisplayName string
	// LastActivityAt orders the conversation in the newest-first list.
	LastActivityAt time.Time
}

// SeedConversation inserts one conversation row, idempotently (the same
// ON CONFLICT DO NOTHING posture as the production upsert's identity half).
// Control defaults to 'agent' — the rollout-safety default.
func (s *ChannelConversationSeeder) SeedConversation(ctx context.Context, input SeedConversationInput) error {
	instant := input.LastActivityAt.UTC().Format(time.RFC3339Nano)
	return s.exec(ctx, fmt.Sprintf(
		`INSERT INTO s_agentic.channel_conversation
		   (agent_channel_id, conversation_key, org, agent_witnessed_through,
		    display_name, last_customer_message_at, last_activity_at, created_at)
		 VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
		 ON CONFLICT (agent_channel_id, conversation_key) DO NOTHING;`,
		dollarQuote(input.AgentChannelID), dollarQuote(input.ConversationKey),
		dollarQuote(input.Org), dollarQuote(instant), dollarQuote(input.DisplayName),
		dollarQuote(instant), dollarQuote(instant), dollarQuote(instant)))
}

func (s *ChannelConversationSeeder) exec(ctx context.Context, sql string) error {
	exitCode, output, err := s.pg.Container.Exec(ctx, []string{
		"psql", "-U", s.pg.User, "-d", s.pg.Database, "-v", "ON_ERROR_STOP=1", "-c", sql,
	})
	if err != nil {
		return fmt.Errorf("exec psql in app-postgres container: %w", err)
	}
	if exitCode != 0 {
		out, _ := io.ReadAll(output)
		return fmt.Errorf("psql exited %d: %s", exitCode, string(out))
	}
	return nil
}

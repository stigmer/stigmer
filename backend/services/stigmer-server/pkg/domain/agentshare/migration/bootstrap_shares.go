// Package migration backfills AgentShare resources from the legacy
// Agent.spec.sharing embedding (decision 011).
//
// Sharing was promoted from a field on the agent spec to the first-class
// agent_share resource, and the old proto fields were removed (numbers
// reserved). Stored agent blobs written before the promotion still carry
// the legacy bytes; because the current descriptors no longer define those
// fields, they surface as protobuf unknown fields after unmarshaling. This
// package decodes them straight from the wire format, creates the
// equivalent AgentShare rows — critically preserving a live
// status.share_link_token, since dropping it would unlock a deliberately
// locked link — and strips the legacy bytes from the agent so the
// conversion is self-marking (a second pass finds nothing to do).
//
// Retention: this backfill exists for external self-hosters upgrading a
// SQLite database across the promotion — data we cannot survey. The cloud
// edition deliberately ships no counterpart (its production data held only
// throwaway demo shares at cutover, and a Mongock changeSet, once executed,
// is permanent changelog history). Being bootstrap_state-gated Go code with
// no such ledger, this package is safe to delete in a future release once
// self-hoster adoption has cycled past the promotion.
package migration

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// bootstrapStateKey gates the backfill so startup pays the agent scan at
// most once. The conversion is additionally idempotent at the data level:
// converted agents have their legacy bytes stripped, so a re-run (e.g.,
// after a restored backup) is safe either way.
const bootstrapStateKey = "agent_share_backfill"

// Store is the narrow store contract the backfill needs: resource access
// plus the bootstrap-state key/value API (which lives on the SQLite store,
// not the generic store.Store interface — schema bookkeeping is a concrete
// concern, not a resource-persistence one).
type Store interface {
	store.Store
	GetBootstrapState(ctx context.Context, key string) (string, error)
	SetBootstrapState(ctx context.Context, key, value string) error
}

// Legacy field numbers, frozen at removal time (see the reserved
// declarations in agent/v1/spec.proto and status.proto).
const (
	legacySpecSharingField     = 8 // AgentSpec.sharing (message)
	legacyStatusLinkTokenField = 2 // AgentStatus.share_link_token (string)
	legacySharingEnabledField  = 1 // AgentSharing.enabled (bool)
	legacySharingOriginsField  = 2 // AgentSharing.allowed_origins (repeated string)
	legacySharingMessagesField = 3 // AgentSharing.messages (message)
	legacySharingAudienceField = 4 // AgentSharing.audience (enum)
)

// BootstrapResult summarizes the outcome of the share backfill.
type BootstrapResult struct {
	Converted int
	Skipped   int
	Errors    int
}

func (r *BootstrapResult) String() string {
	return fmt.Sprintf("converted=%d skipped=%d errors=%d", r.Converted, r.Skipped, r.Errors)
}

// BootstrapAgentShares converts every agent carrying a legacy embedded
// sharing config into an AgentShare row, then strips the legacy bytes from
// the agent. Gated on bootstrap_state so it runs once per database.
func BootstrapAgentShares(ctx context.Context, s Store) (*BootstrapResult, error) {
	if done, err := s.GetBootstrapState(ctx, bootstrapStateKey); err != nil {
		return nil, fmt.Errorf("read bootstrap state: %w", err)
	} else if done != "" {
		return &BootstrapResult{}, nil
	}

	result := &BootstrapResult{}

	records, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
	if err != nil {
		return nil, fmt.Errorf("failed to list agents: %w", err)
	}

	for _, data := range records {
		var agent agentv1.Agent
		if err := proto.Unmarshal(data, &agent); err != nil {
			log.Error().Err(err).Msg("Failed to unmarshal agent record during share backfill")
			result.Errors++
			continue
		}

		converted, err := convertAgentSharing(ctx, s, &agent)
		if err != nil {
			log.Error().
				Err(err).
				Str("agent_id", agent.GetMetadata().GetId()).
				Msg("Failed to convert legacy sharing config")
			result.Errors++
			continue
		}
		if converted {
			result.Converted++
		} else {
			result.Skipped++
		}
	}

	if err := s.SetBootstrapState(ctx, bootstrapStateKey, "completed"); err != nil {
		return nil, fmt.Errorf("record bootstrap state: %w", err)
	}

	if result.Converted > 0 || result.Errors > 0 {
		log.Info().
			Int("converted", result.Converted).
			Int("skipped", result.Skipped).
			Int("errors", result.Errors).
			Msg("Agent share backfill complete")
	}

	return result, nil
}

// legacySharing is the decoded form of the removed AgentSharing message
// plus the removed status token.
type legacySharing struct {
	enabled        bool
	allowedOrigins []string
	messages       *agentsharev1.AgentShareMessages
	audience       agentsharev1.AgentShareAudience
	linkToken      string
}

// convertAgentSharing extracts the legacy sharing bytes from one agent,
// creates the AgentShare row when present, and re-persists the agent with
// the legacy bytes stripped. Returns true when a share was created.
func convertAgentSharing(ctx context.Context, s Store, agent *agentv1.Agent) (bool, error) {
	legacy, found, err := decodeLegacySharing(agent)
	if err != nil {
		return false, err
	}
	if !found {
		return false, nil
	}

	org := agent.GetMetadata().GetOrg()
	slug := agent.GetMetadata().GetSlug()

	// Belt-and-braces row-level idempotency: if the canonical share already
	// exists (interrupted earlier run), don't duplicate it — still strip
	// the agent's legacy bytes below.
	if existing, err := findShareByOrgAndSlug(ctx, s, org, slug); err != nil {
		return false, err
	} else if !existing {
		share := &agentsharev1.AgentShare{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentShare",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:   steps.GenerateID("ash"),
				Org:  org,
				Slug: slug,
				Name: agent.GetMetadata().GetName(),
			},
			Spec: &agentsharev1.AgentShareSpec{
				AgentRef: &apiresource.ApiResourceReference{
					Org:  org,
					Kind: apiresourcekind.ApiResourceKind_agent,
					Slug: slug,
				},
				Enabled:        legacy.enabled,
				Audience:       legacy.audience,
				AllowedOrigins: legacy.allowedOrigins,
				Messages:       legacy.messages,
			},
			Status: &agentsharev1.AgentShareStatus{
				ShareLinkToken: legacy.linkToken,
			},
		}
		if err := steps.SetAuditFieldsForCreate(share); err != nil {
			return false, fmt.Errorf("set audit fields: %w", err)
		}
		if err := s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_share, share.GetMetadata().GetId(), share); err != nil {
			return false, fmt.Errorf("save agent share: %w", err)
		}
		log.Info().
			Str("agent_id", agent.GetMetadata().GetId()).
			Str("share_id", share.GetMetadata().GetId()).
			Bool("enabled", legacy.enabled).
			Bool("link_token_preserved", legacy.linkToken != "").
			Msg("Converted legacy agent sharing config to AgentShare")
	}

	// Strip the legacy bytes so the agent stops carrying dead config and
	// the conversion is self-marking.
	stripLegacySharing(agent)
	if err := s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.GetMetadata().GetId(), agent); err != nil {
		return false, fmt.Errorf("save agent after stripping legacy sharing: %w", err)
	}

	return true, nil
}

// findShareByOrgAndSlug reports whether a share with the given org+slug
// already exists.
func findShareByOrgAndSlug(ctx context.Context, s Store, org, slug string) (bool, error) {
	resources, err := s.ListResources(ctx, apiresourcekind.ApiResourceKind_agent_share)
	if err != nil {
		return false, fmt.Errorf("failed to list agent shares: %w", err)
	}
	for _, data := range resources {
		share := &agentsharev1.AgentShare{}
		if err := proto.Unmarshal(data, share); err != nil {
			continue
		}
		if share.GetMetadata().GetOrg() == org && share.GetMetadata().GetSlug() == slug {
			return true, nil
		}
	}
	return false, nil
}

// decodeLegacySharing reads the removed sharing fields from the agent's
// unknown-field bytes. Returns found=false when the agent never had a
// sharing config (or was already converted).
func decodeLegacySharing(agent *agentv1.Agent) (*legacySharing, bool, error) {
	if agent.GetSpec() == nil {
		return nil, false, nil
	}

	sharingBytes := messageFieldPayload(agent.GetSpec().ProtoReflect().GetUnknown(), legacySpecSharingField)
	if sharingBytes == nil {
		return nil, false, nil
	}

	legacy := &legacySharing{audience: agentsharev1.AgentShareAudience_agent_share_audience_unspecified}

	if err := parseLegacySharingMessage(sharingBytes, legacy); err != nil {
		return nil, false, err
	}

	if agent.GetStatus() != nil {
		legacy.linkToken = stringFieldValue(agent.GetStatus().ProtoReflect().GetUnknown(), legacyStatusLinkTokenField)
	}

	return legacy, true, nil
}

// parseLegacySharingMessage decodes the removed AgentSharing message from
// its wire bytes.
//
// The new AgentShareMessages message kept the exact field numbers of the
// removed AgentSharingMessages (1-3) and AgentShareAudience kept the enum
// values of AgentSharingAudience (0-2), so those two decode directly; only
// the container is walked by hand.
func parseLegacySharingMessage(payload []byte, out *legacySharing) error {
	for len(payload) > 0 {
		num, typ, n := protowire.ConsumeTag(payload)
		if n < 0 {
			return fmt.Errorf("malformed legacy sharing bytes: %w", protowire.ParseError(n))
		}
		payload = payload[n:]

		switch {
		case num == legacySharingEnabledField && typ == protowire.VarintType:
			v, n := protowire.ConsumeVarint(payload)
			if n < 0 {
				return protowire.ParseError(n)
			}
			out.enabled = v != 0
			payload = payload[n:]
		case num == legacySharingOriginsField && typ == protowire.BytesType:
			v, n := protowire.ConsumeBytes(payload)
			if n < 0 {
				return protowire.ParseError(n)
			}
			out.allowedOrigins = append(out.allowedOrigins, string(v))
			payload = payload[n:]
		case num == legacySharingMessagesField && typ == protowire.BytesType:
			v, n := protowire.ConsumeBytes(payload)
			if n < 0 {
				return protowire.ParseError(n)
			}
			messages := &agentsharev1.AgentShareMessages{}
			if err := proto.Unmarshal(v, messages); err != nil {
				return fmt.Errorf("decode legacy sharing messages: %w", err)
			}
			out.messages = messages
			payload = payload[n:]
		case num == legacySharingAudienceField && typ == protowire.VarintType:
			v, n := protowire.ConsumeVarint(payload)
			if n < 0 {
				return protowire.ParseError(n)
			}
			out.audience = agentsharev1.AgentShareAudience(v)
			payload = payload[n:]
		default:
			n := protowire.ConsumeFieldValue(num, typ, payload)
			if n < 0 {
				return protowire.ParseError(n)
			}
			payload = payload[n:]
		}
	}
	return nil
}

// messageFieldPayload extracts a length-delimited field's payload from raw
// unknown-field bytes. Multiple occurrences are concatenated — the wire
// format's message-merge semantics.
func messageFieldPayload(unknown []byte, field protowire.Number) []byte {
	var payload []byte
	for len(unknown) > 0 {
		num, typ, n := protowire.ConsumeTag(unknown)
		if n < 0 {
			return payload
		}
		unknown = unknown[n:]

		if num == field && typ == protowire.BytesType {
			v, n := protowire.ConsumeBytes(unknown)
			if n < 0 {
				return payload
			}
			payload = append(payload, v...)
			unknown = unknown[n:]
			continue
		}

		n = protowire.ConsumeFieldValue(num, typ, unknown)
		if n < 0 {
			return payload
		}
		unknown = unknown[n:]
	}
	return payload
}

// stringFieldValue extracts a string field's value from raw unknown-field
// bytes. The last occurrence wins — the wire format's scalar semantics.
func stringFieldValue(unknown []byte, field protowire.Number) string {
	var value string
	for len(unknown) > 0 {
		num, typ, n := protowire.ConsumeTag(unknown)
		if n < 0 {
			return value
		}
		unknown = unknown[n:]

		if num == field && typ == protowire.BytesType {
			v, n := protowire.ConsumeBytes(unknown)
			if n < 0 {
				return value
			}
			value = string(v)
			unknown = unknown[n:]
			continue
		}

		n = protowire.ConsumeFieldValue(num, typ, unknown)
		if n < 0 {
			return value
		}
		unknown = unknown[n:]
	}
	return value
}

// stripLegacySharing drops the unknown-field bytes from the agent's spec
// and status. The only unknown fields a well-formed pre-promotion agent
// can carry there are the removed sharing fields this backfill just
// consumed.
func stripLegacySharing(agent *agentv1.Agent) {
	if agent.GetSpec() != nil {
		agent.GetSpec().ProtoReflect().SetUnknown(nil)
	}
	if agent.GetStatus() != nil {
		agent.GetStatus().ProtoReflect().SetUnknown(nil)
	}
}

package channelapp

import (
	"context"
	"strings"
	"testing"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// contextWithKind simulates the apiresource interceptor, which injects the
// RPC's resource kind into the request context in production.
func appCtx() context.Context {
	return context.WithValue(context.Background(),
		apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_channel_app)
}

type testHarness struct {
	store      store.Store
	controller *ChannelAppController
	secrets    *encryption.SecretService
}

func newTestHarness(t *testing.T) *testHarness {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	// A real 32-byte key so encrypt/redact round-trips are exercised for
	// real — plaintext-passthrough is a separate, deliberate test.
	secrets, err := encryption.NewSecretService([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("failed to create secret service: %v", err)
	}

	return &testHarness{
		store:      s,
		controller: NewChannelAppController(s, secrets),
		secrets:    secrets,
	}
}

func newSlackApp(name, org string) *channelappv1.ChannelApp {
	return &channelappv1.ChannelApp{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ChannelApp",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  org,
		},
		Spec: &channelappv1.ChannelAppSpec{
			ProviderConfig: &channelappv1.ChannelAppSpec_Slack{
				Slack: &channelappv1.SlackChannelAppConfig{
					ClientId:      "1234.5678",
					ClientSecret:  "shh-client-secret",
					SigningSecret: "shh-signing-secret",
				},
			},
		},
	}
}

func TestChannelAppController_CreateEncryptsAndRedacts(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Create(appCtx(), newSlackApp("Acme Support App", "acme"))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	if !strings.HasPrefix(created.GetMetadata().GetId(), "chapp") {
		t.Errorf("expected chapp id prefix, got %q", created.GetMetadata().GetId())
	}
	if created.GetSpec().GetSlack().GetClientSecret() != RedactedMarker {
		t.Errorf("client_secret must be redacted in the create response, got %q",
			created.GetSpec().GetSlack().GetClientSecret())
	}
	if created.GetSpec().GetSlack().GetSigningSecret() != RedactedMarker {
		t.Errorf("signing_secret must be redacted in the create response, got %q",
			created.GetSpec().GetSlack().GetSigningSecret())
	}

	// The STORED values must be ciphertext — never plaintext, never the
	// marker.
	stored := &channelappv1.ChannelApp{}
	if err := h.store.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_channel_app,
		created.GetMetadata().GetId(), stored); err != nil {
		t.Fatalf("stored app not found: %v", err)
	}
	for field, value := range map[string]string{
		"client_secret":  stored.GetSpec().GetSlack().GetClientSecret(),
		"signing_secret": stored.GetSpec().GetSlack().GetSigningSecret(),
	} {
		if !h.secrets.IsEncrypted(value) {
			t.Errorf("stored %s must be encrypted, got %q", field, value)
		}
	}
	if h.secrets.MustDecrypt(stored.GetSpec().GetSlack().GetClientSecret()) != "shh-client-secret" {
		t.Error("stored client_secret must decrypt to the original plaintext")
	}
}

func TestChannelAppController_CreateRefusesRedactionMarker(t *testing.T) {
	h := newTestHarness(t)

	app := newSlackApp("Acme Support App", "acme")
	app.GetSpec().GetSlack().ClientSecret = RedactedMarker

	_, err := h.controller.Create(appCtx(), app)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for the marker on create, got %v", err)
	}
}

func TestChannelAppController_UpdateMarkerPreservesPerField(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Create(appCtx(), newSlackApp("Acme Support App", "acme"))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	// A mixed update: rotate the signing secret, keep the client secret —
	// per-field independence is the load-bearing behavior.
	update := newSlackApp("Acme Support App", "acme")
	update.Metadata.Id = created.GetMetadata().GetId()
	update.Metadata.Slug = created.GetMetadata().GetSlug()
	update.GetSpec().GetSlack().ClientSecret = RedactedMarker
	update.GetSpec().GetSlack().SigningSecret = "rotated-signing-secret"

	if _, err := h.controller.Update(appCtx(), update); err != nil {
		t.Fatalf("update failed: %v", err)
	}

	stored := &channelappv1.ChannelApp{}
	if err := h.store.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_channel_app,
		created.GetMetadata().GetId(), stored); err != nil {
		t.Fatalf("stored app not found: %v", err)
	}
	if h.secrets.MustDecrypt(stored.GetSpec().GetSlack().GetClientSecret()) != "shh-client-secret" {
		t.Error("marker must preserve the ORIGINAL client_secret")
	}
	if h.secrets.MustDecrypt(stored.GetSpec().GetSlack().GetSigningSecret()) != "rotated-signing-secret" {
		t.Error("the plaintext signing_secret must rotate to the new value")
	}
}

func TestChannelAppController_ApplyRoundTripsWithMarkers(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Apply(appCtx(), newSlackApp("Acme Support App", "acme"))
	if err != nil {
		t.Fatalf("apply-create failed: %v", err)
	}

	// The declarative loop: get (redacted) -> apply back verbatim. The
	// markers must preserve both stored secrets — the wipe hazard the
	// marker convention exists to prevent.
	fetched, err := h.controller.Get(appCtx(), &apiresource.ApiResourceId{
		Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if _, err := h.controller.Apply(appCtx(), fetched); err != nil {
		t.Fatalf("apply-update with redacted secrets failed: %v", err)
	}

	stored := &channelappv1.ChannelApp{}
	if err := h.store.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_channel_app,
		created.GetMetadata().GetId(), stored); err != nil {
		t.Fatalf("stored app not found: %v", err)
	}
	if h.secrets.MustDecrypt(stored.GetSpec().GetSlack().GetClientSecret()) != "shh-client-secret" {
		t.Error("apply round-trip must preserve client_secret")
	}
	if h.secrets.MustDecrypt(stored.GetSpec().GetSlack().GetSigningSecret()) != "shh-signing-secret" {
		t.Error("apply round-trip must preserve signing_secret")
	}
}

func TestChannelAppController_QueriesRedactSecrets(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Create(appCtx(), newSlackApp("Acme Support App", "acme"))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	fetched, err := h.controller.Get(appCtx(), &apiresource.ApiResourceId{
		Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if fetched.GetSpec().GetSlack().GetClientSecret() != RedactedMarker ||
		fetched.GetSpec().GetSlack().GetSigningSecret() != RedactedMarker {
		t.Error("get must redact both secret fields")
	}

	byRef, err := h.controller.GetByReference(appCtx(), &apiresource.ApiResourceReference{
		Org:  "acme",
		Kind: apiresourcekind.ApiResourceKind_channel_app,
		Slug: created.GetMetadata().GetSlug(),
	})
	if err != nil {
		t.Fatalf("getByReference failed: %v", err)
	}
	if byRef.GetSpec().GetSlack().GetClientSecret() != RedactedMarker {
		t.Error("getByReference must redact secrets")
	}

	list, err := h.controller.ListByOrg(appCtx(), &channelappv1.ListChannelAppsByOrgInput{Org: "acme"})
	if err != nil {
		t.Fatalf("listByOrg failed: %v", err)
	}
	if len(list.GetEntries()) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(list.GetEntries()))
	}
	if list.GetEntries()[0].GetSpec().GetSlack().GetSigningSecret() != RedactedMarker {
		t.Error("listByOrg must redact secrets on every entry")
	}

	other, err := h.controller.ListByOrg(appCtx(), &channelappv1.ListChannelAppsByOrgInput{Org: "other"})
	if err != nil {
		t.Fatalf("listByOrg (other org) failed: %v", err)
	}
	if len(other.GetEntries()) != 0 {
		t.Error("listByOrg must filter by org")
	}
}

// TestValidateProviderImmutableStep pins the provider-arm immutability at
// the step level. Only one provider arm (slack) exists in v1, so a real
// cross-provider flip cannot pass proto validation through the full
// pipeline yet — the step is exercised directly, exactly the agentchannel
// provider-immutability test's posture, to pin the refusal a second arm
// (WhatsApp, T05) will hit.
func TestValidateProviderImmutableStep(t *testing.T) {
	existing := newSlackApp("Acme Support App", "acme")

	// The input carries NO provider arm — the closest constructible
	// stand-in for "a different provider" until a second arm exists.
	input := newSlackApp("Acme Support App", "acme")
	input.Spec = &channelappv1.ChannelAppSpec{}

	reqCtx := pipeline.NewRequestContext(appCtx(), input)
	reqCtx.Set(steps.ExistingResourceKey, existing)

	err := (&validateProviderImmutableStep{}).Execute(reqCtx)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for a provider change, got %v", err)
	}
	if !strings.Contains(status.Convert(err).Message(), "provider of a channel app cannot be changed") {
		t.Errorf("unexpected message: %v", err)
	}

	// An unchanged arm passes.
	same := pipeline.NewRequestContext(appCtx(), newSlackApp("Acme Support App", "acme"))
	same.Set(steps.ExistingResourceKey, existing)
	if err := (&validateProviderImmutableStep{}).Execute(same); err != nil {
		t.Errorf("an unchanged provider arm must pass: %v", err)
	}
}

func TestChannelAppController_DeleteBlockedByReferencingChannel(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Create(appCtx(), newSlackApp("Acme Support App", "acme"))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	// Seed a referencing channel directly — the referential check reads
	// stored state, not the channel pipeline.
	channel := &agentchannelv1.AgentChannel{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "ach_01ref",
			Name: "support-bot-slack",
			Org:  "acme",
			Slug: "support-bot-slack",
		},
		Spec: &agentchannelv1.AgentChannelSpec{
			AppRef: &apiresource.ApiResourceReference{
				Org:  "acme",
				Kind: apiresourcekind.ApiResourceKind_channel_app,
				Slug: created.GetMetadata().GetSlug(),
			},
		},
	}
	if err := h.store.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent_channel, "ach_01ref", channel); err != nil {
		t.Fatalf("failed to seed referencing channel: %v", err)
	}

	_, err = h.controller.Delete(appCtx(), &apiresource.ApiResourceDeleteInput{
		ResourceId: created.GetMetadata().GetId()})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition while referenced, got %v", err)
	}
	if !strings.Contains(status.Convert(err).Message(), "support-bot-slack") {
		t.Errorf("the refusal must name a referencing channel: %v", err)
	}

	// Unreference, then deletion succeeds and returns the redacted app.
	if err := h.store.DeleteResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent_channel, "ach_01ref"); err != nil {
		t.Fatalf("failed to remove referencing channel: %v", err)
	}
	deleted, err := h.controller.Delete(appCtx(), &apiresource.ApiResourceDeleteInput{
		ResourceId: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("delete failed after unreferencing: %v", err)
	}
	if deleted.GetSpec().GetSlack().GetClientSecret() != RedactedMarker {
		t.Error("the delete response must be redacted like every other response")
	}
}

func TestChannelAppController_DeleteBlockedByRelativeRef(t *testing.T) {
	h := newTestHarness(t)

	created, err := h.controller.Create(appCtx(), newSlackApp("Acme Support App", "acme"))
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	// A pre-normalization channel whose app_ref has no org — the check
	// must treat empty as the channel's own org, not skip the row.
	channel := &agentchannelv1.AgentChannel{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "ach_02rel",
			Name: "relative-ref-channel",
			Org:  "acme",
			Slug: "relative-ref-channel",
		},
		Spec: &agentchannelv1.AgentChannelSpec{
			AppRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_channel_app,
				Slug: created.GetMetadata().GetSlug(),
			},
		},
	}
	if err := h.store.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent_channel, "ach_02rel", channel); err != nil {
		t.Fatalf("failed to seed referencing channel: %v", err)
	}

	_, err = h.controller.Delete(appCtx(), &apiresource.ApiResourceDeleteInput{
		ResourceId: created.GetMetadata().GetId()})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for a relative-ref reference, got %v", err)
	}
}

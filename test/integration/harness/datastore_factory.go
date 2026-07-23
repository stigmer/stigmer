package harness

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/require"
)

// Channel-sender session metadata keys. The cloud ChannelSessionBroker
// stamps these onto SessionSpec.metadata at session-create time, and the
// record RPCs' reach layer (RecordReach.sessionSubject) reads exactly
// these keys to resolve the record-layer subject. There is no shared
// cross-language constant, so the values here MUST stay byte-identical
// to ChannelRuntimeConstants in stigmer-cloud
// (domain/agentic/agentchannel/runtime/ChannelRuntimeConstants.java);
// the reach test asserts through them end to end, so a drift fails loudly.
const (
	ChannelSenderIdentityMetadataKey = "stigmer.ai/channel-sender-identity"
	ChannelSenderKindMetadataKey     = "stigmer.ai/channel-sender-kind"

	// SenderKindWhatsAppPhone mirrors SENDER_KIND_WHATSAPP_PHONE — the
	// sender-identity kind for a WhatsApp wa_id (digits, no "+").
	SenderKindWhatsAppPhone = "whatsapp_phone"
)

// ChannelSenderMetadata builds the SessionSpec.metadata entries a channel
// broker would stamp for a verified sender, for use with WithSessionMetadata.
func ChannelSenderMetadata(senderKind, senderValue string) map[string]string {
	return map[string]string{
		ChannelSenderIdentityMetadataKey: senderValue,
		ChannelSenderKindMetadataKey:     senderKind,
	}
}

// CreateDatastore applies a datastore under TestOrg and registers a forced
// delete on test cleanup (force acknowledges the guarded hard delete of a
// datastore that holds records). The name gets a unique suffix; callers
// address the record RPCs by the returned resource's slug.
//
// Note the cleanup ordering contract: the datastore delete is blocked while
// an agent still references it, so create the datastore BEFORE the agent —
// t.Cleanup runs LIFO and deletes the agent first.
func CreateDatastore(t *testing.T, ctx context.Context, clients *Clients, name string, spec *datastorev1.DatastoreSpec) *datastorev1.Datastore {
	t.Helper()

	ds := &datastorev1.Datastore{
		ApiVersion: TestAPIVersion,
		Kind:       "Datastore",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name + "-" + uuid.New().String()[:8],
			Org:  TestOrg,
		},
		Spec: spec,
	}

	created, err := clients.DatastoreCommand.Apply(ctx, ds)
	require.NoError(t, err, "apply datastore %q should succeed", name)
	require.NotEmpty(t, created.GetMetadata().GetId(), "datastore should have an ID")
	require.NotEmpty(t, created.GetMetadata().GetSlug(), "datastore should have a slug")

	t.Logf("created datastore: name=%s, id=%s, slug=%s",
		created.GetMetadata().GetName(),
		created.GetMetadata().GetId(),
		created.GetMetadata().GetSlug())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.DatastoreCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId:     created.GetMetadata().GetId(),
			VersionMessage: "integration test cleanup",
			Force:          true,
		})
		if err != nil {
			t.Logf("warning: failed to clean up datastore %s: %v", name, err)
		}
	})

	return created
}

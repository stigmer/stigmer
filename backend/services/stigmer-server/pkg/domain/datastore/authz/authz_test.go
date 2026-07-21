package authz

import (
	"testing"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/identity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func channelSubject(kind, value string) *datastorev1.DatastoreSubject {
	return &datastorev1.DatastoreSubject{
		Kind: &datastorev1.DatastoreSubject_ChannelSender{
			ChannelSender: &datastorev1.ChannelSenderSubject{SenderKind: kind, Value: value},
		},
	}
}

func principalSubject(kind, id string) *datastorev1.DatastoreSubject {
	return &datastorev1.DatastoreSubject{
		Kind: &datastorev1.DatastoreSubject_Principal{
			Principal: &iampolicyv1.ApiResourceRef{Kind: kind, Id: id},
		},
	}
}

func TestResolveRole(t *testing.T) {
	doctor := channelSubject("whatsapp_phone", "9198")
	authorization := &datastorev1.DatastoreAuthorization{
		Roles: []*datastorev1.DatastoreRole{{Name: "admin"}, {Name: "patient"}},
		Bindings: []*datastorev1.DatastoreRoleBinding{
			{Subject: doctor, Role: "admin"},
		},
		DefaultRole: "patient",
	}

	t.Run("bound subject resolves its binding", func(t *testing.T) {
		role, ok := ResolveRole(authorization, channelSubject("whatsapp_phone", "9198"))
		require.True(t, ok)
		assert.Equal(t, "admin", role)
	})

	t.Run("unbound subject falls back to default_role", func(t *testing.T) {
		role, ok := ResolveRole(authorization, channelSubject("whatsapp_phone", "0000"))
		require.True(t, ok)
		assert.Equal(t, "patient", role)
	})

	t.Run("no default_role means no role", func(t *testing.T) {
		noDefault := &datastorev1.DatastoreAuthorization{
			Roles:    authorization.Roles,
			Bindings: authorization.Bindings,
		}
		_, ok := ResolveRole(noDefault, channelSubject("whatsapp_phone", "0000"))
		assert.False(t, ok, "deny by default: unbound caller with no default_role has no role")
	})

	t.Run("nil authorization denies everyone", func(t *testing.T) {
		_, ok := ResolveRole(nil, doctor)
		assert.False(t, ok)
	})

	t.Run("channel sender never matches a principal binding", func(t *testing.T) {
		principalBound := &datastorev1.DatastoreAuthorization{
			Roles:    []*datastorev1.DatastoreRole{{Name: "admin"}},
			Bindings: []*datastorev1.DatastoreRoleBinding{{Subject: principalSubject("identity_account", "9198"), Role: "admin"}},
		}
		_, ok := ResolveRole(principalBound, channelSubject("whatsapp_phone", "9198"))
		assert.False(t, ok, "same value under a different subject arm must not match")
	})
}

func TestCheckVerb(t *testing.T) {
	coll := &datastorev1.CollectionDeclaration{
		Name: "bookings",
		Grants: []*datastorev1.DatastoreGrant{
			{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read, datastorev1.DatastoreVerb_insert}},
			{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_update, datastorev1.DatastoreVerb_delete},
				Scope: datastorev1.DatastoreGrantScope_own},
			{Role: "admin", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read, datastorev1.DatastoreVerb_insert,
				datastorev1.DatastoreVerb_update, datastorev1.DatastoreVerb_delete}},
		},
	}

	t.Run("granted verb with all scope", func(t *testing.T) {
		grant, ok := CheckVerb(coll, "patient", datastorev1.DatastoreVerb_read)
		require.True(t, ok)
		assert.False(t, grant.Own)
	})

	t.Run("granted verb with own scope", func(t *testing.T) {
		grant, ok := CheckVerb(coll, "patient", datastorev1.DatastoreVerb_update)
		require.True(t, ok)
		assert.True(t, grant.Own)
	})

	t.Run("role without the verb is denied", func(t *testing.T) {
		wideColl := &datastorev1.CollectionDeclaration{
			Grants: []*datastorev1.DatastoreGrant{
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read}},
			},
		}
		_, ok := CheckVerb(wideColl, "patient", datastorev1.DatastoreVerb_delete)
		assert.False(t, ok)
	})

	t.Run("unknown role is denied", func(t *testing.T) {
		_, ok := CheckVerb(coll, "stranger", datastorev1.DatastoreVerb_read)
		assert.False(t, ok)
	})

	t.Run("widest scope wins when grants overlap", func(t *testing.T) {
		overlapping := &datastorev1.CollectionDeclaration{
			Grants: []*datastorev1.DatastoreGrant{
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_update},
					Scope: datastorev1.DatastoreGrantScope_own},
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_update}},
			},
		}
		grant, ok := CheckVerb(overlapping, "patient", datastorev1.DatastoreVerb_update)
		require.True(t, ok)
		assert.False(t, grant.Own, "an all grant subsumes an own grant for the same verb")
	})

	t.Run("no grants at all denies (deny by default)", func(t *testing.T) {
		_, ok := CheckVerb(&datastorev1.CollectionDeclaration{}, "admin", datastorev1.DatastoreVerb_read)
		assert.False(t, ok)
	})
}

func TestEffectiveVerbs(t *testing.T) {
	coll := &datastorev1.CollectionDeclaration{
		Grants: []*datastorev1.DatastoreGrant{
			{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_insert, datastorev1.DatastoreVerb_read}},
			{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_update},
				Scope: datastorev1.DatastoreGrantScope_own},
		},
	}

	t.Run("projects granted verbs in enum order with own markers", func(t *testing.T) {
		verbs := EffectiveVerbs(coll, "patient", true)
		require.Len(t, verbs, 3)
		assert.Equal(t, datastorev1.DatastoreVerb_read, verbs[0].GetVerb())
		assert.False(t, verbs[0].GetOwnScope())
		assert.Equal(t, datastorev1.DatastoreVerb_insert, verbs[1].GetVerb())
		assert.Equal(t, datastorev1.DatastoreVerb_update, verbs[2].GetVerb())
		assert.True(t, verbs[2].GetOwnScope())
	})

	t.Run("no role yields empty access", func(t *testing.T) {
		assert.Empty(t, EffectiveVerbs(coll, "", false))
	})
}

func TestSubjectKeyContract(t *testing.T) {
	// The storage-key encoding is a cross-edition contract; pin it.
	assert.Equal(t, "channel/whatsapp_phone/9198", identity.SubjectKey(channelSubject("whatsapp_phone", "9198")))
	assert.Equal(t, "principal/identity_account/system", identity.SubjectKey(identity.LocalSubject()))
	assert.NotEqual(t,
		identity.SubjectKey(channelSubject("whatsapp_phone", "9198")),
		identity.SubjectKey(principalSubject("whatsapp_phone", "9198")),
		"subject arms must never collide in key space")
}

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
		// Duplicate (role, verb) grants are refused at apply time since
		// read_fields shipped, but stored specs predating that rule are
		// still served — this pins their documented resolution.
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
		assert.Empty(t, verbs[0].GetReadableFields(), "unrestricted read carries no field list (empty means all)")
		assert.Equal(t, datastorev1.DatastoreVerb_insert, verbs[1].GetVerb())
		assert.Equal(t, datastorev1.DatastoreVerb_update, verbs[2].GetVerb())
		assert.True(t, verbs[2].GetOwnScope())
	})

	t.Run("restricted read carries readable_fields in declaration order", func(t *testing.T) {
		restricted := &datastorev1.CollectionDeclaration{
			Fields: []*datastorev1.FieldDeclaration{
				{Name: "slot_start", Type: datastorev1.FieldType_timestamp},
				{Name: "patient_phone", Type: datastorev1.FieldType_string},
				{Name: "status", Type: datastorev1.FieldType_string},
			},
			Grants: []*datastorev1.DatastoreGrant{
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read},
					// Listed out of declaration order on purpose: the
					// projection re-orders deterministically.
					ReadFields: []string{"status", "created_by", "slot_start"}},
			},
		}
		verbs := EffectiveVerbs(restricted, "patient", true)
		require.Len(t, verbs, 1)
		assert.Equal(t, []string{"slot_start", "status", "created_by"}, verbs[0].GetReadableFields(),
			"declared fields in declaration order, created_by last")
	})

	t.Run("no role yields empty access", func(t *testing.T) {
		assert.Empty(t, EffectiveVerbs(coll, "", false))
	})
}

func TestResolveReadProjection(t *testing.T) {
	coll := &datastorev1.CollectionDeclaration{
		Name: "bookings",
		Fields: []*datastorev1.FieldDeclaration{
			{Name: "slot_start", Type: datastorev1.FieldType_timestamp},
			{Name: "patient_phone", Type: datastorev1.FieldType_string},
			{Name: "status", Type: datastorev1.FieldType_string},
		},
		Grants: []*datastorev1.DatastoreGrant{
			{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read, datastorev1.DatastoreVerb_insert},
				ReadFields: []string{"slot_start", "status"}},
			{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_update, datastorev1.DatastoreVerb_delete},
				Scope: datastorev1.DatastoreGrantScope_own},
			{Role: "admin", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read}},
			{Role: "auditor", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read},
				ReadFields: []string{"status", "created_by"}},
			{Role: "clerk", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_insert}},
		},
	}

	t.Run("unrestricted read grant allows every column", func(t *testing.T) {
		proj := ResolveReadProjection(coll, "admin", true)
		assert.True(t, proj.All)
		assert.True(t, proj.AllowsField("patient_phone"))
		assert.True(t, proj.AllowsCreatedBy())
	})

	t.Run("restricted grant allows exactly its listed fields", func(t *testing.T) {
		proj := ResolveReadProjection(coll, "patient", true)
		assert.False(t, proj.All)
		assert.True(t, proj.AllowsField("slot_start"))
		assert.True(t, proj.AllowsField("status"))
		assert.False(t, proj.AllowsField("patient_phone"))
		assert.False(t, proj.AllowsCreatedBy(),
			"created_by is exposed only when listed — it is the attribution PII")
	})

	t.Run("created_by entry exposes attribution without becoming a field", func(t *testing.T) {
		proj := ResolveReadProjection(coll, "auditor", true)
		assert.True(t, proj.AllowsCreatedBy())
		assert.False(t, proj.AllowsField("created_by"),
			"created_by is not a declared field; it rides on the envelope, not in fields")
	})

	t.Run("write-only role gets the zero projection", func(t *testing.T) {
		proj := ResolveReadProjection(coll, "clerk", true)
		assert.False(t, proj.All)
		assert.False(t, proj.AllowsField("status"))
		assert.False(t, proj.AllowsCreatedBy())
	})

	t.Run("no role gets the zero projection", func(t *testing.T) {
		proj := ResolveReadProjection(coll, "", false)
		assert.False(t, proj.AllowsField("status"))
		assert.False(t, proj.AllowsCreatedBy())
	})

	t.Run("legacy duplicate read grants resolve unrestricted", func(t *testing.T) {
		// Stored specs predating the duplicate-(role, verb) rule can
		// only hold UNRESTRICTED duplicates (read_fields shipped with
		// the rule): any unrestricted read grant wins, preserving the
		// access such specs always had.
		legacy := &datastorev1.CollectionDeclaration{
			Grants: []*datastorev1.DatastoreGrant{
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read},
					Scope: datastorev1.DatastoreGrantScope_own},
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read}},
			},
		}
		proj := ResolveReadProjection(legacy, "patient", true)
		assert.True(t, proj.All)
	})
}

func TestReadableFields(t *testing.T) {
	coll := &datastorev1.CollectionDeclaration{
		Fields: []*datastorev1.FieldDeclaration{
			{Name: "a", Type: datastorev1.FieldType_string},
			{Name: "b", Type: datastorev1.FieldType_string},
			{Name: "c", Type: datastorev1.FieldType_string},
		},
	}

	assert.Nil(t, ReadableFields(coll, ReadProjection{All: true}), "unrestricted projects no list (empty means all)")
	assert.Nil(t, ReadableFields(coll, ReadProjection{}), "denied projects no list")
	assert.Equal(t, []string{"a", "c"},
		ReadableFields(coll, ReadProjection{Fields: map[string]bool{"c": true, "a": true}}),
		"declaration order, independent of allowlist order")
	assert.Equal(t, []string{"b", CreatedByField},
		ReadableFields(coll, ReadProjection{Fields: map[string]bool{"b": true}, CreatedBy: true}),
		"created_by rides last")
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

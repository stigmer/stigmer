// Package identity defines the record-layer caller subject for the OSS
// edition.
//
// The record-layer authorization model (DD-002) resolves a subject →
// binding → role → grant, stamps created_by, and scopes `own` grants
// against it. In cloud the subject is derived from the caller's
// credential (channel sender via session metadata, or platform
// principal). OSS has no caller identity in handler context — it is a
// local, single-operator edition — so the subject is a single canonical
// platform principal: the local operator.
//
// This is the "honest dual-edition layering" posture: the Layer-2
// resolution algorithm is identical in both editions; only the SOURCE of
// the subject differs (fixed here, credential-derived in cloud).
// created_by therefore carries an honest attribution ("the local
// operator"), `own` scope works, and deny-by-default holds: a datastore
// with no default_role and no binding for the local principal denies
// every verb, exactly as in cloud.
package identity

import (
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
)

// LocalPrincipalID is the identity of the OSS local operator, matching
// the audit-actor placeholder used across the OSS control plane
// (pipeline steps stamp ApiResourceAuditActor{Id: "system"}).
const LocalPrincipalID = "system"

// LocalPrincipalKind is the ApiResourceRef kind for the local operator.
const LocalPrincipalKind = "identity_account"

// SystemOrg is the well-known organization the OSS seedpack bootstraps
// (id == slug == "stigmer"). OSS is operationally single-tenant: record
// RPCs, which carry no org field ("org resolves from the caller's
// credential"), resolve their datastore against this org.
const SystemOrg = "stigmer"

// LocalSubject returns the record-layer subject for the OSS local
// operator. Callers must treat the result as immutable shared state.
func LocalSubject() *datastorev1.DatastoreSubject {
	return &datastorev1.DatastoreSubject{
		Kind: &datastorev1.DatastoreSubject_Principal{
			Principal: &iampolicyv1.ApiResourceRef{
				Kind: LocalPrincipalKind,
				Id:   LocalPrincipalID,
			},
		},
	}
}

// SubjectsEqual reports whether two record-layer subjects denote the same
// caller. It is the single equality definition used by binding matching
// and `own`-scope checks, and must match the Java implementation:
//   - two channel senders are equal iff sender_kind and value both match;
//   - two principals are equal iff kind and id both match (the optional
//     ApiResourceRef.relation qualifier is not identity-bearing);
//   - a channel sender never equals a principal.
func SubjectsEqual(a, b *datastorev1.DatastoreSubject) bool {
	if a == nil || b == nil {
		return false
	}
	return SubjectKey(a) == SubjectKey(b)
}

// SubjectKey derives the deterministic comparison key for a subject,
// stored alongside each record's attribution so own-scoped grants can
// filter at the substrate ("created_by_key = caller's key") instead of
// unmarshaling every row. The encoding is a storage contract shared with
// the Java implementation:
//
//	channel sender:     "channel/<sender_kind>/<value>"
//	platform principal: "principal/<kind>/<id>"
//
// It embodies the same equality definition as SubjectsEqual: the
// ApiResourceRef.relation qualifier is deliberately excluded.
func SubjectKey(s *datastorev1.DatastoreSubject) string {
	switch k := s.GetKind().(type) {
	case *datastorev1.DatastoreSubject_ChannelSender:
		return "channel/" + k.ChannelSender.GetSenderKind() + "/" + k.ChannelSender.GetValue()
	case *datastorev1.DatastoreSubject_Principal:
		return "principal/" + k.Principal.GetKind() + "/" + k.Principal.GetId()
	default:
		return ""
	}
}

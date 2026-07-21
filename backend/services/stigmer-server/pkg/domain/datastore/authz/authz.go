// Package authz implements the record-layer authorization chain
// (DD-002 Layer 2): resolved subject → binding → role → per-collection
// grant, verb + row scope. Deny by default at every link.
//
// This algorithm is core-identical in both editions; only the subject
// SOURCE differs (fixed local principal in OSS, credential-derived in
// cloud). It deliberately does not consult the resource layer (FGA /
// kind-registry authorization) — that is Layer 1's job.
package authz

import (
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/identity"
)

// ResolveRole resolves the caller's role: the first binding whose
// subject equals the caller wins; unbound callers fall back to
// default_role; no default_role means no role (denied every verb).
// The bool result reports whether a role was resolved at all.
func ResolveRole(authorization *datastorev1.DatastoreAuthorization, subject *datastorev1.DatastoreSubject) (string, bool) {
	if authorization == nil {
		return "", false
	}
	for _, binding := range authorization.GetBindings() {
		if identity.SubjectsEqual(binding.GetSubject(), subject) {
			return binding.GetRole(), true
		}
	}
	if dr := authorization.GetDefaultRole(); dr != "" {
		return dr, true
	}
	return "", false
}

// Grant is the caller's effective permission for one verb on one
// collection.
type Grant struct {
	// Own limits the verb to records whose server-stamped created_by
	// equals the caller (DatastoreGrantScope_own).
	Own bool
}

// CheckVerb resolves whether the role holds a verb on the collection.
// When multiple grants give the role the same verb, the widest scope
// wins (an `all` grant subsumes an `own` grant).
func CheckVerb(coll *datastorev1.CollectionDeclaration, role string, verb datastorev1.DatastoreVerb) (Grant, bool) {
	granted := false
	own := true
	for _, g := range coll.GetGrants() {
		if g.GetRole() != role {
			continue
		}
		for _, v := range g.GetVerbs() {
			if v != verb {
				continue
			}
			granted = true
			if g.GetScope() != datastorev1.DatastoreGrantScope_own {
				own = false // scope all (or unset, which means all)
			}
		}
	}
	if !granted {
		return Grant{}, false
	}
	return Grant{Own: own}, true
}

// EffectiveVerbs projects the caller's full access to a collection, in
// the shape describeDatastore returns: one entry per granted verb with
// its own-scope marker, ordered by verb enum value for determinism.
// An empty result means no access (deny by default).
func EffectiveVerbs(coll *datastorev1.CollectionDeclaration, role string, hasRole bool) []*datastorev1.VerbGrantDescription {
	if !hasRole {
		return nil
	}
	verbs := []datastorev1.DatastoreVerb{
		datastorev1.DatastoreVerb_read,
		datastorev1.DatastoreVerb_insert,
		datastorev1.DatastoreVerb_update,
		datastorev1.DatastoreVerb_delete,
	}
	var out []*datastorev1.VerbGrantDescription
	for _, verb := range verbs {
		if grant, ok := CheckVerb(coll, role, verb); ok {
			out = append(out, &datastorev1.VerbGrantDescription{
				Verb:     verb,
				OwnScope: grant.Own,
			})
		}
	}
	return out
}

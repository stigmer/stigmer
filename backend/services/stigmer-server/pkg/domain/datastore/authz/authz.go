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
// wins (an `all` grant subsumes an `own` grant). Duplicate (role, verb)
// grants are refused at apply time since read_fields shipped; the
// widest-scope-wins resolution remains the documented behavior for
// stored specs that predate that rule.
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

// CreatedByField is the read_fields entry exposing the created_by
// attribution subject — the one non-declared name the allowlist admits.
const CreatedByField = "created_by"

// ReadProjection is the caller's column-level read access to one
// collection (DatastoreGrant.read_fields). Every record RPC response —
// find results and write echoes alike — passes through it: a caller
// never receives a field its read grant does not allow.
//
// The zero value denies every column (no read grant at all): the
// envelope carries id and timestamps only. The system fields id,
// created_at, and updated_at are always readable and are not modeled
// here.
type ReadProjection struct {
	// All reports an unrestricted read grant: every declared field and
	// created_by are readable.
	All bool
	// Fields is the readable declared-field set of a restricted read
	// grant (nil when All or denied).
	Fields map[string]bool
	// CreatedBy reports whether a restricted read grant lists
	// created_by. Consult AllowsCreatedBy, which folds in All.
	CreatedBy bool
}

// AllowsField reports whether a declared field is readable.
func (p ReadProjection) AllowsField(name string) bool {
	return p.All || p.Fields[name]
}

// AllowsCreatedBy reports whether the created_by attribution subject is
// readable: always under an unrestricted grant, under a restricted one
// only when listed.
func (p ReadProjection) AllowsCreatedBy() bool {
	return p.All || p.CreatedBy
}

// ResolveReadProjection resolves the caller's column-level read access
// to the collection. No read grant denies every column; a read grant
// without read_fields allows every column; a restricted grant allows
// exactly its listed fields, with created_by only when listed.
//
// Legal specs hold at most one read grant per role (the duplicate
// (role, verb) apply-time rule), so no merge rules exist. Stored specs
// predating that rule can only hold unrestricted duplicates —
// read_fields shipped together with the rule — and resolve to All, the
// same access they always had.
func ResolveReadProjection(coll *datastorev1.CollectionDeclaration, role string, hasRole bool) ReadProjection {
	if !hasRole {
		return ReadProjection{}
	}
	proj := ReadProjection{}
	granted := false
	for _, g := range coll.GetGrants() {
		if g.GetRole() != role || !grantsVerb(g, datastorev1.DatastoreVerb_read) {
			continue
		}
		granted = true
		if len(g.GetReadFields()) == 0 {
			return ReadProjection{All: true}
		}
		if proj.Fields == nil {
			proj.Fields = map[string]bool{}
		}
		for _, name := range g.GetReadFields() {
			if name == CreatedByField {
				proj.CreatedBy = true
				continue
			}
			proj.Fields[name] = true
		}
	}
	if !granted {
		return ReadProjection{}
	}
	return proj
}

// ReadableFields projects a restricted read grant for the
// describeDatastore contract: the readable declared fields in
// declaration order, then created_by when listed. Empty means
// unrestricted (or no read grant, where the access list carries no
// read entry at all).
func ReadableFields(coll *datastorev1.CollectionDeclaration, proj ReadProjection) []string {
	if proj.All || (proj.Fields == nil && !proj.CreatedBy) {
		return nil
	}
	var out []string
	for _, f := range coll.GetFields() {
		if proj.Fields[f.GetName()] {
			out = append(out, f.GetName())
		}
	}
	if proj.CreatedBy {
		out = append(out, CreatedByField)
	}
	return out
}

// grantsVerb reports whether a grant's verb set contains the verb.
func grantsVerb(g *datastorev1.DatastoreGrant, verb datastorev1.DatastoreVerb) bool {
	for _, v := range g.GetVerbs() {
		if v == verb {
			return true
		}
	}
	return false
}

// EffectiveVerbs projects the caller's full access to a collection, in
// the shape describeDatastore returns: one entry per granted verb with
// its own-scope marker, ordered by verb enum value for determinism.
// The read entry carries the readable fields of a restricted read
// grant (empty means every field). An empty result means no access
// (deny by default).
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
		grant, ok := CheckVerb(coll, role, verb)
		if !ok {
			continue
		}
		entry := &datastorev1.VerbGrantDescription{
			Verb:     verb,
			OwnScope: grant.Own,
		}
		if verb == datastorev1.DatastoreVerb_read {
			entry.ReadableFields = ReadableFields(coll, ResolveReadProjection(coll, role, hasRole))
		}
		out = append(out, entry)
	}
	return out
}

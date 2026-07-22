// Package validation implements the datastore spec validations that
// protovalidate cannot express: cross-field and cross-message rules over
// the declared schema.
//
// The proto layer (buf.validate on spec.proto) already enforces
// reserved field names, enum_values-on-string-only, snake_case patterns,
// and every max_items quota. This package validates ONLY what remains
// (the proto marks each rule @internal):
//
//   - collection-name uniqueness within the datastore
//   - field/constraint-name uniqueness within a collection
//   - role-reference integrity: bindings, grants, and default_role name
//     declared roles
//   - field defaults are type-compatible with the declared type
//     (enum_values membership included)
//   - IANA timezone validity; rejection of tz-referencing expressions
//     when spec.timezone is unset
//   - unique/exists constraint field references resolve to declared
//     fields; ExistsConstraint.collection resolves to a declared
//     collection
//   - CEL expressions compile against the constraint environment
//
// Every message here is part of the cross-edition error contract: the
// Java implementation (T04) must reject the same spec with the same
// message bytes.
package validation

import (
	"fmt"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/celeval"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
)

// MaxDatastoresPerOrg is the per-org datastore quota (T02 Stage-0 ruling
// R1). It is the one structural limit the proto cannot carry, enforced
// as a domain validation in the create pipeline of both editions.
const MaxDatastoresPerOrg = 25

// ValidateSpec validates a datastore spec against the rules above.
// It returns the first violation as an error whose message is the
// cross-edition contract; callers wrap it in INVALID_ARGUMENT.
func ValidateSpec(spec *datastorev1.DatastoreSpec) error {
	if spec == nil {
		return nil
	}

	if tz := spec.GetTimezone(); tz != "" {
		if _, err := time.LoadLocation(tz); err != nil {
			return fmt.Errorf("timezone %q is not a valid IANA timezone", tz)
		}
	}

	if err := validateAuthorization(spec); err != nil {
		return err
	}

	seenCollections := map[string]bool{}
	for _, coll := range spec.GetCollections() {
		if seenCollections[coll.GetName()] {
			return fmt.Errorf("duplicate collection name %q", coll.GetName())
		}
		seenCollections[coll.GetName()] = true
	}

	for _, coll := range spec.GetCollections() {
		if err := validateCollection(spec, coll); err != nil {
			return err
		}
	}

	return nil
}

func validateAuthorization(spec *datastorev1.DatastoreSpec) error {
	authz := spec.GetAuthorization()
	if authz == nil {
		return nil
	}

	declared := map[string]bool{}
	for _, role := range authz.GetRoles() {
		if declared[role.GetName()] {
			return fmt.Errorf("duplicate role name %q", role.GetName())
		}
		declared[role.GetName()] = true
	}

	for _, binding := range authz.GetBindings() {
		if !declared[binding.GetRole()] {
			return fmt.Errorf("binding references undeclared role %q", binding.GetRole())
		}
	}

	if dr := authz.GetDefaultRole(); dr != "" && !declared[dr] {
		return fmt.Errorf("default_role references undeclared role %q", dr)
	}

	return nil
}

func validateCollection(spec *datastorev1.DatastoreSpec, coll *datastorev1.CollectionDeclaration) error {
	cname := coll.GetName()
	tzDeclared := spec.GetTimezone() != ""

	declaredRoles := map[string]bool{}
	for _, role := range spec.GetAuthorization().GetRoles() {
		declaredRoles[role.GetName()] = true
	}

	fields := map[string]*datastorev1.FieldDeclaration{}
	for _, f := range coll.GetFields() {
		if _, dup := fields[f.GetName()]; dup {
			return fmt.Errorf("collection %q declares field %q more than once", cname, f.GetName())
		}
		fields[f.GetName()] = f

		if err := validateDefault(cname, f); err != nil {
			return err
		}
	}

	// Constraint names share one namespace within the collection: unique
	// violations resolve substrate index names back to constraints, and
	// ErrorInfo carries the bare constraint name, so cross-class
	// collisions would be ambiguous.
	constraintNames := map[string]bool{}
	checkConstraintName := func(name string) error {
		if constraintNames[name] {
			return fmt.Errorf("collection %q declares constraint %q more than once", cname, name)
		}
		constraintNames[name] = true
		return nil
	}

	for _, u := range coll.GetUniques() {
		if err := checkConstraintName(u.GetName()); err != nil {
			return err
		}
		for _, fieldName := range u.GetFields() {
			if _, ok := fields[fieldName]; !ok {
				return fmt.Errorf("unique constraint %q in collection %q references undeclared field %q",
					u.GetName(), cname, fieldName)
			}
		}
		if where := u.GetWhere(); where != nil {
			f, ok := fields[where.GetField()]
			if !ok {
				return fmt.Errorf("unique constraint %q in collection %q references undeclared field %q",
					u.GetName(), cname, where.GetField())
			}
			if _, err := schema.CanonicalizeValue(f, where.GetEquals().AsInterface()); err != nil {
				return fmt.Errorf("unique constraint %q in collection %q: where.equals %v", u.GetName(), cname, err)
			}
		}
	}

	for _, chk := range coll.GetChecks() {
		if err := checkConstraintName(chk.GetName()); err != nil {
			return err
		}
		if err := validateExpression(cname, chk.GetName(), chk.GetExpression(), false, tzDeclared); err != nil {
			return err
		}
		if when := chk.GetWhen(); when != "" {
			if err := validateExpression(cname, chk.GetName(), when, false, tzDeclared); err != nil {
				return err
			}
		}
	}

	validateExists := func(class string, constraints []*datastorev1.ExistsConstraint) error {
		for _, ex := range constraints {
			if err := checkConstraintName(ex.GetName()); err != nil {
				return err
			}
			if schema.CollectionByName(spec, ex.GetCollection()) == nil {
				return fmt.Errorf("%s constraint %q in collection %q references undeclared collection %q",
					class, ex.GetName(), cname, ex.GetCollection())
			}
			if err := validateExpression(cname, ex.GetName(), ex.GetWhere(), true, tzDeclared); err != nil {
				return err
			}
			if when := ex.GetWhen(); when != "" {
				// `when` gates on the candidate only — `that` is out of scope.
				if err := validateExpression(cname, ex.GetName(), when, false, tzDeclared); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := validateExists("exists", coll.GetExists()); err != nil {
		return err
	}
	if err := validateExists("not_exists", coll.GetNotExists()); err != nil {
		return err
	}

	for _, grant := range coll.GetGrants() {
		if !declaredRoles[grant.GetRole()] {
			return fmt.Errorf("grant in collection %q references undeclared role %q", cname, grant.GetRole())
		}
	}

	return nil
}

// validateDefault checks a field default's type compatibility (including
// enum membership) by running it through the canonical encoder.
func validateDefault(cname string, f *datastorev1.FieldDeclaration) error {
	if f.GetDefault() == nil {
		return nil
	}
	v := f.GetDefault().AsInterface()
	if v == nil {
		return fmt.Errorf("collection %q field %q declares a null default; omit the default instead", cname, f.GetName())
	}
	if _, err := schema.CanonicalizeValue(f, v); err != nil {
		return fmt.Errorf("collection %q field %q default is incompatible with type %s: %v",
			cname, f.GetName(), f.GetType(), err)
	}
	return nil
}

// validateExpression compiles a CEL expression against the constraint
// environment (withThat brings `that` into scope for exists/not_exists
// `where` expressions) and enforces the tz-declaration gate. Compilation
// errors surface with the compiler's message so operators can fix the
// expression.
func validateExpression(cname, constraintName, expr string, withThat, tzDeclared bool) error {
	if !tzDeclared && referencesTz(expr) {
		return fmt.Errorf("constraint %q in collection %q references tz but the datastore declares no timezone",
			constraintName, cname)
	}
	if err := celeval.Compile(expr, withThat); err != nil {
		return fmt.Errorf("constraint %q in collection %q has an invalid expression: %v",
			constraintName, cname, err)
	}
	return nil
}

// referencesTz reports whether an expression mentions the tz constant as
// an identifier (not as part of a longer name or a string literal — the
// tokenizer-level scan is deliberately simple because a false positive
// only produces a clearer apply-time error than the CEL undeclared-
// reference it would otherwise be).
func referencesTz(expr string) bool {
	isIdent := func(b byte) bool {
		return b == '_' || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
	}
	for i := 0; i+2 <= len(expr); i++ {
		if expr[i] != 't' || expr[i+1] != 'z' {
			continue
		}
		before := i == 0 || !isIdent(expr[i-1])
		after := i+2 == len(expr) || !isIdent(expr[i+2])
		if before && after && !insideStringLiteral(expr, i) {
			return true
		}
	}
	return false
}

// insideStringLiteral reports whether position pos falls inside a single-
// or double-quoted CEL string literal.
func insideStringLiteral(expr string, pos int) bool {
	var quote byte
	for i := 0; i < pos; i++ {
		c := expr[i]
		if quote != 0 {
			if c == '\\' {
				i++
			} else if c == quote {
				quote = 0
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
		}
	}
	return quote != 0
}

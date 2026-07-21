// Package celeval is the datastore constraint-expression engine: a
// scope-fenced CEL environment evaluated in domain logic, identically in
// both editions (DD-004 SD-2).
//
// Environment (the cross-edition contract, exercised by the conformance
// corpus at apis/ai/stigmer/agentic/datastore/v1/conformance/):
//
//   - `this` — the candidate record (post-merge on updates), a map of
//     declared field name to typed value
//   - `that` — a record of the target collection (exists/not_exists
//     `where` expressions only)
//   - `tz`   — the datastore's IANA timezone string
//   - the CEL standard library
//   - two curated functions, and nothing else:
//     timeOfDay(timestamp, tz) -> "HH:MM:SS"   (canonical time encoding)
//     localDate(timestamp, tz) -> "YYYY-MM-DD" (canonical date encoding)
//
// The curated functions exist to make a timestamp field comparable to
// declared time/date fields: both return the exact canonical encodings
// those field types store, which are lexicographically chronological,
// so `timeOfDay(this.slot_start, tz) >= that.session_start` is a plain
// string comparison.
//
// Field typing inside `this`/`that` (see ActivationFromRecord): timestamp
// fields surface as CEL timestamps (standard accessors like
// getMinutes(tz) and getDayOfWeek(tz) work), date/time as canonical
// strings, integer as int, number as double, bool as bool, json as dyn.
// Absent optional fields evaluate as null.
package celeval

import (
	"fmt"
	"sync"
	"time"

	// Embed the IANA timezone database so constraint evaluation is
	// deterministic on hosts without system tzdata (the OSS server is a
	// single local-first binary; Windows has no /usr/share/zoneinfo).
	_ "time/tzdata"

	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/common/types"
	"github.com/google/cel-go/common/types/ref"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
)

var (
	envOnce     sync.Once
	envThis     *cel.Env // this + tz
	envThisThat *cel.Env // this + that + tz
	envErr      error

	// programs caches compiled expressions. Expressions come from
	// operator-authored specs (bounded: <=20 constraints per class per
	// collection), so the cache is effectively the set of live
	// constraint expressions.
	programs sync.Map // key: programKey, value: cel.Program
)

type programKey struct {
	expr     string
	withThat bool
}

func environments() (*cel.Env, *cel.Env, error) {
	envOnce.Do(func() {
		curated := []cel.EnvOption{
			cel.Variable("this", cel.MapType(cel.StringType, cel.DynType)),
			cel.Variable("tz", cel.StringType),
			cel.Function("timeOfDay",
				cel.Overload("timeOfDay_timestamp_string",
					[]*cel.Type{cel.TimestampType, cel.StringType}, cel.StringType,
					cel.BinaryBinding(func(ts, tz ref.Val) ref.Val {
						return formatInZone(ts, tz, "15:04:05")
					}),
				),
			),
			cel.Function("localDate",
				cel.Overload("localDate_timestamp_string",
					[]*cel.Type{cel.TimestampType, cel.StringType}, cel.StringType,
					cel.BinaryBinding(func(ts, tz ref.Val) ref.Val {
						return formatInZone(ts, tz, "2006-01-02")
					}),
				),
			),
		}

		envThis, envErr = cel.NewEnv(curated...)
		if envErr != nil {
			return
		}
		envThisThat, envErr = envThis.Extend(
			cel.Variable("that", cel.MapType(cel.StringType, cel.DynType)),
		)
	})
	return envThis, envThisThat, envErr
}

// formatInZone converts a CEL timestamp to a canonical string in the
// given IANA zone. The zone is validated at apply time, so a load
// failure here is a defect, surfaced as a CEL error rather than a panic.
func formatInZone(ts, tz ref.Val, layout string) ref.Val {
	t, ok := ts.Value().(time.Time)
	if !ok {
		return types.NewErr("timeOfDay/localDate: first argument must be a timestamp")
	}
	zone, ok := tz.Value().(string)
	if !ok {
		return types.NewErr("timeOfDay/localDate: second argument must be a timezone string")
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return types.NewErr("invalid timezone %q", zone)
	}
	return types.String(t.In(loc).Format(layout))
}

// Compile type-checks an expression against the constraint environment
// and confirms it yields a boolean. withThat controls whether `that` is
// in scope (exists/not_exists `where` expressions only) — a check
// expression referencing `that` fails compilation with CEL's
// undeclared-reference message.
func Compile(expr string, withThat bool) error {
	_, err := compile(expr, withThat)
	return err
}

func compile(expr string, withThat bool) (cel.Program, error) {
	key := programKey{expr: expr, withThat: withThat}
	if cached, ok := programs.Load(key); ok {
		return cached.(cel.Program), nil
	}

	thisEnv, thatEnv, err := environments()
	if err != nil {
		return nil, fmt.Errorf("cel environment: %w", err)
	}
	env := thisEnv
	if withThat {
		env = thatEnv
	}

	ast, issues := env.Compile(expr)
	if issues != nil && issues.Err() != nil {
		return nil, issues.Err()
	}
	if out := ast.OutputType(); out != cel.BoolType && out != cel.DynType {
		return nil, fmt.Errorf("expression must evaluate to a boolean, got %s", out)
	}

	prg, err := env.Program(ast)
	if err != nil {
		return nil, err
	}
	programs.Store(key, prg)
	return prg, nil
}

// EvaluateBool evaluates a compiled-cacheable expression against the
// activation. that may be nil (check expressions and `when` gates).
// Evaluation errors (e.g. a comparison against null) surface as errors —
// the caller decides how a failed evaluation maps to the constraint
// contract.
func EvaluateBool(expr string, this map[string]any, that map[string]any, tz string) (bool, error) {
	prg, err := compile(expr, that != nil)
	if err != nil {
		return false, err
	}

	activation := map[string]any{"this": this, "tz": tz}
	if that != nil {
		activation["that"] = that
	}

	out, _, err := prg.Eval(activation)
	if err != nil {
		return false, err
	}
	b, ok := out.Value().(bool)
	if !ok {
		return false, fmt.Errorf("expression evaluated to %T, expected boolean", out.Value())
	}
	return b, nil
}

// ActivationFromRecord converts a record's canonical field values (as
// stored — see the schema package) into the CEL activation shape for
// `this`/`that`. Every declared field is present: absent or null values
// surface as CEL null so expressions can test them, and timestamp
// canonical strings surface as time.Time so the standard timestamp
// accessors work.
func ActivationFromRecord(coll *datastorev1.CollectionDeclaration, fields map[string]any) map[string]any {
	activation := make(map[string]any, len(coll.GetFields()))
	for _, f := range coll.GetFields() {
		v, ok := fields[f.GetName()]
		if !ok || v == nil {
			activation[f.GetName()] = types.NullValue
			continue
		}
		if f.GetType() == datastorev1.FieldType_timestamp {
			if s, isStr := v.(string); isStr {
				if t, err := time.Parse(schema.TimestampFormat, s); err == nil {
					activation[f.GetName()] = t
					continue
				}
			}
		}
		activation[f.GetName()] = v
	}
	return activation
}

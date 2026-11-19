// The component framework: what one part of a Stigmer install (its keys, its
// database, its Temporal, its server, its runner) promises the controller,
// and the result it reports back.
//
// The controller walks the components in a fixed order. A component whose
// dependencies are not Ready is not reconciled; it waits, naming them. The
// rest converge their objects and report a Result: a phase, a one-word
// reason, the object the message is about and a sentence a platform engineer
// can act on. Reconcile returns an error only for something the operator
// retries (an API call that failed); a declaration that cannot be carried
// out is a Refused result with words, never an error, because retrying it
// changes nothing.
//
// Env carries two readers on purpose. Client is the manager's cached client:
// applies, and reads of the objects the operator labels. Reader goes to the
// API server directly: Secrets an adopter names, pods and Events read only
// while explaining a component that is not ready, prerequisites someone
// else installed. The cache holds only labelled Secrets, so the operator
// never keeps the cluster's other Secrets in memory.

package component

import (
	"context"

	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// Component is one part of an install.
type Component interface {
	// Name is the component's name in status.
	Name() string
	// Dependencies are the components that must be Ready first.
	Dependencies() []string
	// Reconcile converges the component's objects and reports where it stands.
	Reconcile(ctx context.Context, env *Env) (Result, error)
}

// Env is what a component reconciles against.
type Env struct {
	// Client is the cached client; every write goes through it.
	Client client.Client
	// Reader reads straight from the API server.
	Reader client.Reader
	// Stigmer is the resource being reconciled.
	Stigmer *stigmerv1.Stigmer
}

// Result is a component's standing after one pass.
type Result struct {
	Phase   stigmerv1.Phase
	Reason  stigmerv1.ComponentReason
	Object  *stigmerv1.ObjectReference
	Message string
}

// Ready reports a component that is serving.
func Ready(message string) Result {
	return Result{Phase: stigmerv1.PhaseReady, Reason: stigmerv1.ReasonHealthy, Message: message}
}

// Deploying reports a component still converging, or one that is failing in
// a way that may clear on its own (a crash loop, a pull that may succeed).
func Deploying(reason stigmerv1.ComponentReason, object *stigmerv1.ObjectReference, message string) Result {
	return Result{Phase: stigmerv1.PhaseDeploying, Reason: reason, Object: object, Message: message}
}

// Pending reports a component that waits for something outside itself.
func Pending(reason stigmerv1.ComponentReason, object *stigmerv1.ObjectReference, message string) Result {
	return Result{Phase: stigmerv1.PhasePending, Reason: reason, Object: object, Message: message}
}

// Refused reports a declaration that cannot be carried out until the
// declaration or the cluster changes; the message says what to change.
func Refused(reason stigmerv1.ComponentReason, object *stigmerv1.ObjectReference, message string) Result {
	return Result{Phase: stigmerv1.PhaseRefused, Reason: reason, Object: object, Message: message}
}

// Ref names an object for a Result.
func Ref(kind, namespace, name string) *stigmerv1.ObjectReference {
	return &stigmerv1.ObjectReference{Kind: kind, Namespace: namespace, Name: name}
}

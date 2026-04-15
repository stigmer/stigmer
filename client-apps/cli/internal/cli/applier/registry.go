package applier

import (
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Registry maps resource kinds to their ApplyHandler implementations.
// Constructed via NewRegistry and populated with explicit Register calls
// at command setup time — no init()-based side effects.
type Registry struct {
	handlers map[apiresourcekind.ApiResourceKind]ApplyHandler
}

// NewRegistry creates an empty handler registry.
func NewRegistry() *Registry {
	return &Registry{
		handlers: make(map[apiresourcekind.ApiResourceKind]ApplyHandler),
	}
}

// Register adds a handler to the registry, keyed by the handler's Kind().
// Panics if a handler for the same kind is already registered — this is a
// programming error caught at startup, not a runtime condition.
func (r *Registry) Register(handler ApplyHandler) {
	kind := handler.Kind()
	if _, exists := r.handlers[kind]; exists {
		panic("applier: duplicate handler registered for " + kind.String())
	}
	r.handlers[kind] = handler
}

// Get returns the handler for a resource kind, or (nil, false) if none
// is registered.
func (r *Registry) Get(kind apiresourcekind.ApiResourceKind) (ApplyHandler, bool) {
	h, ok := r.handlers[kind]
	return h, ok
}

// All returns every registered handler. Order is non-deterministic.
func (r *Registry) All() []ApplyHandler {
	result := make([]ApplyHandler, 0, len(r.handlers))
	for _, h := range r.handlers {
		result = append(result, h)
	}
	return result
}

// RegisteredKinds returns the set of kinds that have a registered handler.
func (r *Registry) RegisteredKinds() map[apiresourcekind.ApiResourceKind]bool {
	result := make(map[apiresourcekind.ApiResourceKind]bool, len(r.handlers))
	for kind := range r.handlers {
		result[kind] = true
	}
	return result
}

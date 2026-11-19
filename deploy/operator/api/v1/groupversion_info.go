// The stigmer.ai/v1 API group: one kind, Stigmer, the whole of a self-hosted
// install declared in one resource.
//
// The group and version are permanent names an adopter types; they never
// change once released. Registration follows controller-runtime's scheme
// builder so the manager, envtest and the generated deepcopy share one
// definition.

// +kubebuilder:object:generate=true
// +groupName=stigmer.ai
package v1

import (
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/scheme"
)

var (
	// GroupVersion is the group and version every object in this package is served under.
	GroupVersion = schema.GroupVersion{Group: "stigmer.ai", Version: "v1"}

	// SchemeBuilder registers this package's kinds with a runtime scheme.
	SchemeBuilder = &scheme.Builder{GroupVersion: GroupVersion}

	// AddToScheme adds this package's kinds to a scheme.
	AddToScheme = SchemeBuilder.AddToScheme
)

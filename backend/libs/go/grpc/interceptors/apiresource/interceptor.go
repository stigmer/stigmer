package apiresource

import (
	"context"
	"strings"
	"sync"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
)

// Context key for api_resource_kind
type contextKey string

const ApiResourceKindKey contextKey = "api_resource_kind"

// Cache for extracted kinds to avoid repeated reflection
var (
	kindCache = make(map[string]apiresourcekind.ApiResourceKind)
	cacheMu   sync.RWMutex
)

// UnaryServerInterceptor injects api_resource_kind into context from proto service descriptor.
//
// This interceptor extracts the api_resource_kind from the service-level proto option
// (defined in rpc_service_options.proto) and injects it into the request context.
//
// Example proto:
//
//	service AgentCommandController {
//	  option (ai.stigmer.commons.apiresource.api_resource_kind) = agent;
//	  ...
//	}
//
// Pipeline steps can then retrieve the kind using GetApiResourceKind(ctx).
//
// The extraction uses reflection and is cached per service to minimize overhead.
func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		// Extract api_resource_kind from service descriptor
		kind := extractApiResourceKind(info.FullMethod)

		// Inject into context if found
		if kind != apiresourcekind.ApiResourceKind_api_resource_kind_unknown {
			ctx = context.WithValue(ctx, ApiResourceKindKey, kind)
			log.Trace().
				Str("method", info.FullMethod).
				Str("kind", kind.String()).
				Msg("Injected api_resource_kind into context")
		} else {
			log.Trace().
				Str("method", info.FullMethod).
				Msg("No api_resource_kind found for service")
		}

		// Continue with request handling
		return handler(ctx, req)
	}
}

// extractApiResourceKind extracts the kind from the service descriptor.
// Results are cached to avoid repeated reflection.
func extractApiResourceKind(fullMethod string) apiresourcekind.ApiResourceKind {
	// Parse service name from full method
	// e.g., "/ai.stigmer.agentic.agent.v1.AgentCommandController/create"
	//    -> "ai.stigmer.agentic.agent.v1.AgentCommandController"
	serviceName := parseServiceName(fullMethod)

	// Check cache
	cacheMu.RLock()
	if kind, ok := kindCache[serviceName]; ok {
		cacheMu.RUnlock()
		return kind
	}
	cacheMu.RUnlock()

	// Extract from proto descriptor
	kind := extractFromDescriptor(serviceName)

	// Cache the result
	cacheMu.Lock()
	kindCache[serviceName] = kind
	cacheMu.Unlock()

	log.Debug().
		Str("service", serviceName).
		Str("kind", kind.String()).
		Msg("Extracted and cached api_resource_kind")

	return kind
}

// parseServiceName extracts the service name from a gRPC full method path.
//
// Input:  "/ai.stigmer.agentic.agent.v1.AgentCommandController/create"
// Output: "ai.stigmer.agentic.agent.v1.AgentCommandController"
func parseServiceName(fullMethod string) string {
	// Remove leading "/"
	if len(fullMethod) > 0 && fullMethod[0] == '/' {
		fullMethod = fullMethod[1:]
	}

	// Find the last "/" which separates service from method
	lastSlash := strings.LastIndex(fullMethod, "/")
	if lastSlash > 0 {
		return fullMethod[:lastSlash]
	}

	return fullMethod
}

// extractFromDescriptor uses protobuf reflection to extract api_resource_kind
// from the service descriptor's options.
func extractFromDescriptor(serviceName string) apiresourcekind.ApiResourceKind {
	// Find service descriptor in global registry
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(serviceName))
	if err != nil {
		log.Trace().
			Str("service", serviceName).
			Err(err).
			Msg("Service descriptor not found in registry")
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown
	}

	serviceDesc, ok := desc.(protoreflect.ServiceDescriptor)
	if !ok {
		log.Trace().
			Str("service", serviceName).
			Msg("Descriptor is not a ServiceDescriptor")
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown
	}

	// Get service options
	opts, ok := serviceDesc.Options().(*descriptorpb.ServiceOptions)
	if !ok {
		log.Trace().
			Str("service", serviceName).
			Msg("Could not get ServiceOptions")
		return apiresourcekind.ApiResourceKind_api_resource_kind_unknown
	}

	// Extract api_resource_kind extension
	if proto.HasExtension(opts, apiresource.E_ApiResourceKind) {
		kind := proto.GetExtension(opts, apiresource.E_ApiResourceKind).(apiresourcekind.ApiResourceKind)
		return kind
	}

	log.Trace().
		Str("service", serviceName).
		Msg("Service has no api_resource_kind option")
	return apiresourcekind.ApiResourceKind_api_resource_kind_unknown
}

// GetApiResourceKind retrieves the api_resource_kind from the request context.
//
// Returns api_resource_kind_unknown if not found (e.g., for services without the option).
func GetApiResourceKind(ctx context.Context) apiresourcekind.ApiResourceKind {
	if kind, ok := ctx.Value(ApiResourceKindKey).(apiresourcekind.ApiResourceKind); ok {
		return kind
	}
	return apiresourcekind.ApiResourceKind_api_resource_kind_unknown
}

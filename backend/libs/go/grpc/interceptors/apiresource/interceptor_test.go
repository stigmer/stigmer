package apiresource

import (
	"context"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
	"google.golang.org/grpc"
)

func TestUnaryServerInterceptor(t *testing.T) {
	tests := []struct {
		name           string
		fullMethod     string
		expectedKind   apiresourcekind.ApiResourceKind
		shouldHaveKind bool
	}{
		{
			name:           "Agent command controller - should extract agent kind",
			fullMethod:     "/ai.stigmer.agentic.agent.v1.AgentCommandController/create",
			expectedKind:   apiresourcekind.ApiResourceKind_agent,
			shouldHaveKind: true,
		},
		{
			name:           "AgentInstance command controller - should extract agent_instance kind",
			fullMethod:     "/ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController/create",
			expectedKind:   apiresourcekind.ApiResourceKind_agent_instance,
			shouldHaveKind: true,
		},
		{
			name:           "Unknown service - should not have kind",
			fullMethod:     "/com.example.UnknownService/someMethod",
			expectedKind:   apiresourcekind.ApiResourceKind_api_resource_kind_unknown,
			shouldHaveKind: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create the interceptor
			interceptor := UnaryServerInterceptor()

			// Mock handler that captures the context
			var capturedCtx context.Context
			handler := func(ctx context.Context, req interface{}) (interface{}, error) {
				capturedCtx = ctx
				return "response", nil
			}

			// Mock gRPC info
			info := &grpc.UnaryServerInfo{
				FullMethod: tt.fullMethod,
			}

			// Execute interceptor
			ctx := context.Background()
			_, err := interceptor(ctx, nil, info, handler)
			assert.NoError(t, err)

			// Verify kind was injected into context
			kind := GetApiResourceKind(capturedCtx)

			if tt.shouldHaveKind {
				assert.Equal(t, tt.expectedKind, kind,
					"Expected kind %s but got %s", tt.expectedKind, kind)
			} else {
				assert.Equal(t, apiresourcekind.ApiResourceKind_api_resource_kind_unknown, kind,
					"Expected unknown kind for service without api_resource_kind option")
			}
		})
	}
}

func TestParseServiceName(t *testing.T) {
	tests := []struct {
		name           string
		fullMethod     string
		expectedResult string
	}{
		{
			name:           "Standard gRPC full method",
			fullMethod:     "/ai.stigmer.agentic.agent.v1.AgentCommandController/create",
			expectedResult: "ai.stigmer.agentic.agent.v1.AgentCommandController",
		},
		{
			name:           "Full method without leading slash",
			fullMethod:     "ai.stigmer.agentic.agent.v1.AgentCommandController/create",
			expectedResult: "ai.stigmer.agentic.agent.v1.AgentCommandController",
		},
		{
			name:           "Simple service name",
			fullMethod:     "/SimpleService/method",
			expectedResult: "SimpleService",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseServiceName(tt.fullMethod)
			assert.Equal(t, tt.expectedResult, result)
		})
	}
}

func TestExtractApiResourceKind_Caching(t *testing.T) {
	// Clear cache for test
	cacheMu.Lock()
	kindCache = make(map[string]apiresourcekind.ApiResourceKind)
	cacheMu.Unlock()

	fullMethod := "/ai.stigmer.agentic.agent.v1.AgentCommandController/create"

	// First call - should extract from descriptor
	kind1 := extractApiResourceKind(fullMethod)
	assert.Equal(t, apiresourcekind.ApiResourceKind_agent, kind1)

	// Verify cache was populated
	serviceName := parseServiceName(fullMethod)
	cacheMu.RLock()
	cachedKind, exists := kindCache[serviceName]
	cacheMu.RUnlock()

	assert.True(t, exists, "Kind should be cached after first extraction")
	assert.Equal(t, apiresourcekind.ApiResourceKind_agent, cachedKind)

	// Second call - should use cache (won't fail even if descriptor is unavailable)
	kind2 := extractApiResourceKind(fullMethod)
	assert.Equal(t, kind1, kind2, "Cached kind should match first extraction")
}

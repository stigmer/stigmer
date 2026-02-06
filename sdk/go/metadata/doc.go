// Package metadata provides SDK-level metadata utilities shared across all resource packages.
//
// This package contains functions for generating SDK annotations that are added to
// resource metadata during synthesis. These annotations track which SDK version
// created the resource and when.
//
// # SDK Annotations
//
// All resources created by the Go SDK include metadata annotations:
//
//   - stigmer.ai/sdk.language: "go"
//   - stigmer.ai/sdk.version: SDK version (e.g., "0.1.0")
//   - stigmer.ai/sdk.generated-at: Unix timestamp when resource was synthesized
//
// These annotations are used by the CLI and platform for telemetry and debugging.
//
// # Usage
//
// Resource packages (agent, workflow, mcpserver, etc.) import this package
// and call SDKAnnotations() in their ToProto() methods:
//
//	import "github.com/stigmer/stigmer/sdk/go/metadata"
//
//	func (a *Agent) ToProto() (*agentv1.Agent, error) {
//	    return &agentv1.Agent{
//	        Metadata: &apiresource.ApiResourceMetadata{
//	            Annotations: metadata.SDKAnnotations(),
//	        },
//	    }
//	}
package metadata

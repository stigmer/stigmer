// Package applier defines the ApplyHandler interface and registry for
// the file-based apply pipeline (stigmer apply -f).
//
// Each resource kind that supports declarative apply implements ApplyHandler.
// The framework provides the common orchestration: load -> validate ->
// org resolution -> dry-run branch -> apply -> display. Handlers supply
// the kind-specific logic at each step.
//
// This package is distinct from internal/cli/apply, which handles SDK
// synthesis mode (stigmer apply with a project file).
package applier

import (
	"context"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

// ApplyHandler encapsulates the kind-specific logic for declarative resource
// apply. Each method receives or returns proto.Message; implementations
// type-assert to their concrete proto type internally.
type ApplyHandler interface {
	// Kind returns the ApiResourceKind this handler manages.
	Kind() apiresourcekind.ApiResourceKind

	// LoadFromBytes deserializes raw YAML/JSON bytes into a proto message.
	// Structural validation (protovalidate or manual checks) runs inside
	// the loader; callers receive a validated proto on success.
	LoadFromBytes(raw []byte) (proto.Message, error)

	// Validate performs cross-field business rule validation that cannot be
	// expressed in proto validation annotations (e.g., DAG cycle detection
	// for workflows, MCP access consistency for agents).
	// Return nil if no extra validation is needed.
	Validate(msg proto.Message) error

	// Metadata extracts the ApiResourceMetadata from the proto message.
	// The framework uses it for org mismatch warnings, org injection,
	// and building the ApiResourceReference after a successful apply.
	Metadata(msg proto.Message) *apiresource.ApiResourceMetadata

	// Apply calls the backend Apply RPC. The message will already have
	// metadata.org populated by the framework. Apply is never called
	// during dry-run; the framework handles that branch.
	Apply(ctx context.Context, client *stigmer.Client, msg proto.Message) (*ApplyResult, error)

	// BuildDryRunResult constructs the structured CLI output for a
	// dry-run preview of the resource.
	BuildDryRunResult(msg proto.Message) *clioutput.CommandResult

	// BuildApplyResult constructs the structured CLI output for a
	// successful apply, showing resource details and next-step hints.
	BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult
}

// ApplyResult is the kind-agnostic return value from ApplyHandler.Apply.
type ApplyResult struct {
	// Resource is the proto message returned by the backend Apply RPC.
	Resource proto.Message
	// Created is true when the resource was newly created (vs updated).
	Created bool
}

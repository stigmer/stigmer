package root

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apply"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/skill"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/grpc"
)

// executeProjectApply implements the SDK track where stigmer.yaml has an entry_point set.
//
//  1. Infer runtime from entry_point file extension
//  2. Execute SDK synthesis (runs user code, captures generated resource manifests)
//  3. Establish backend connection
//  4. Push synthesized skills (skills use push, not apply)
//  5. Apply synthesized agents, workflows, and MCP servers individually
//  6. Collect all ApiResourceReferences into Project.Spec.Members
//  7. Apply the project to register membership for reconciliation
//  8. Render structured summary
func executeProjectApply(detectResult *project.DetectResult, opts projectApplyOptions) error {
	renderer := clioutput.NewRenderer(opts.OutputFormat, os.Stdout, os.Stderr)
	entryPoint := detectResult.Project.Spec.EntryPoint

	runtime, err := apply.InferRuntime(entryPoint)
	if err != nil {
		return err
	}

	climsg.Info("SDK mode: %s (runtime: %s)", entryPoint, runtime)

	if opts.DryRun {
		return executeSDKDryRun(detectResult, runtime, renderer)
	}

	cfg, err := config.Load()
	if err != nil {
		return errors.Wrap(err, "failed to load configuration")
	}

	orgID, err := resolveApplyOrganization(cfg, detectResult.Project, opts.OrgOverride)
	if err != nil {
		return err
	}

	synthResult, err := runSynthesis(detectResult.ConfigDir, entryPoint, runtime, orgID)
	if err != nil {
		return err
	}

	conn, err := connectAndEnsureDaemon(cfg)
	if err != nil {
		return err
	}
	defer conn.Close()

	members, appliedServers, err := pushAndApplyResources(synthResult.Result, detectResult.ConfigDir, conn, orgID)
	if err != nil {
		return err
	}

	discoverAppliedMcpServersSDK(appliedServers, conn)

	detectResult.Project.Spec.Members = members
	projectResult, err := project.Apply(&project.ApplyOptions{
		Project: detectResult.Project,
		OrgID:   orgID,
		Conn:    conn,
		Quiet:   false,
		DryRun:  false,
		Prune:   opts.PruneEnabled,
	})
	if err != nil {
		return errors.Wrap(err, "failed to apply project")
	}

	renderer.Render(buildSDKResult(projectResult, members))
	return nil
}

// runSynthesis executes the SDK entry point and parses the synthesized resource manifests.
func runSynthesis(projectDir, entryPoint string, runtime apply.Runtime, orgID string) (*apply.SynthesizeResult, error) {
	climsg.Info("Running SDK synthesis...")

	result, err := apply.Synthesize(&apply.SynthesizeOptions{
		ProjectDir: projectDir,
		Runtime:    runtime,
		EntryPoint: entryPoint,
		OrgID:      orgID,
	})
	if err != nil {
		return nil, errors.Wrap(err, "SDK synthesis failed")
	}

	r := result.Result
	climsg.Info("Synthesis complete: %d agent(s), %d workflow(s), %d MCP server(s), %d skill(s)",
		r.AgentCount(), r.WorkflowCount(), r.McpServerCount(), r.SkillSynthCount())

	return result, nil
}

// connectAndEnsureDaemon ensures the daemon is running (local mode) and
// returns a gRPC connection. The caller is responsible for org resolution.
func connectAndEnsureDaemon(cfg *config.Config) (*grpc.ClientConn, error) {
	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, errors.Wrap(err, "failed to start daemon")
		}
	}

	climsg.Info("Connecting to backend...")
	conn, err := backend.NewConnection()
	if err != nil {
		return nil, errors.Wrap(err, "failed to connect to backend")
	}
	climsg.Info("Connected to backend")

	return conn, nil
}

// pushAndApplyResources pushes skills and applies agents/workflows/MCP servers,
// collecting ApiResourceReferences for project membership.
// Skills are pushed first because agents may reference them.
// Also returns applied MCP server protos for post-apply discovery.
func pushAndApplyResources(
	synthResult *synthesis.Result,
	projectDir string,
	conn *grpc.ClientConn,
	orgID string,
) ([]*apiresource.ApiResourceReference, []*mcpserverv1.McpServer, error) {
	var members []*apiresource.ApiResourceReference

	skillRefs, err := pushSynthesizedSkills(synthResult.SkillSynths, projectDir, conn, orgID)
	if err != nil {
		return nil, nil, err
	}
	members = append(members, skillRefs...)

	resourceRefs, appliedServers, err := applySynthesizedResources(synthResult, conn, orgID)
	if err != nil {
		return nil, nil, err
	}
	members = append(members, resourceRefs...)

	return members, appliedServers, nil
}

// pushSynthesizedSkills pushes each SkillSynth to the backend and returns references.
// SkillSynth sources are either local directories or remote git repositories.
func pushSynthesizedSkills(
	synths []*skillv1.SkillSynth,
	projectDir string,
	conn *grpc.ClientConn,
	orgID string,
) ([]*apiresource.ApiResourceReference, error) {
	var refs []*apiresource.ApiResourceReference

	for i, synth := range synths {
		climsg.Info("Pushing skill %d/%d...", i+1, len(synths))

		result, err := pushSkillSynth(synth, projectDir, conn, orgID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to push skill %d", i+1)
		}
		if result == nil {
			continue
		}

		refs = append(refs, &apiresource.ApiResourceReference{
			Org:  orgID,
			Kind: apiresourcekind.ApiResourceKind_skill,
			Slug: result.Slug,
		})
	}

	return refs, nil
}

// pushSkillSynth dispatches a single SkillSynth to the appropriate push function
// based on its source type (local directory or git repository).
// Local paths are resolved relative to the project directory.
func pushSkillSynth(
	synth *skillv1.SkillSynth,
	projectDir string,
	conn *grpc.ClientConn,
	orgID string,
) (*artifact.SkillArtifactResult, error) {
	tag := synth.Tag

	switch src := synth.Source.(type) {
	case *skillv1.SkillSynth_Local:
		dir := src.Local.Path
		if !filepath.IsAbs(dir) {
			dir = filepath.Join(projectDir, dir)
		}
		return skill.Push(skill.PushOptions{
			Directory: dir,
			OrgID:     orgID,
			Tag:       tag,
			Conn:      conn,
		})

	case *skillv1.SkillSynth_Git:
		return skill.PushRemote(skill.RemotePushOptions{
			GitURL:    src.Git.Url,
			GitRef:    src.Git.Ref,
			GitSubdir: src.Git.Subdir,
			OrgID:     orgID,
			Tag:       tag,
			Conn:      conn,
		})

	default:
		return nil, fmt.Errorf("skill synth has no source configured")
	}
}

// applySynthesizedResources applies agents, workflows, and MCP servers from
// synthesis output, returning references for each successfully applied resource
// and the applied MCP server protos for post-apply discovery.
func applySynthesizedResources(
	synthResult *synthesis.Result,
	conn *grpc.ClientConn,
	orgID string,
) ([]*apiresource.ApiResourceReference, []*mcpserverv1.McpServer, error) {
	var refs []*apiresource.ApiResourceReference
	var appliedServers []*mcpserverv1.McpServer

	for _, a := range synthResult.Agents {
		climsg.Info("Applying agent: %s", a.Metadata.Name)
		result, err := agent.Apply(&agent.ApplyOptions{
			Agent: a, OrgID: orgID, Conn: conn,
		})
		if err != nil {
			return nil, nil, errors.Wrapf(err, "failed to apply agent %s", a.Metadata.Name)
		}
		refs = append(refs, buildResourceReference(result.Agent.Metadata, apiresourcekind.ApiResourceKind_agent))
	}

	for _, w := range synthResult.Workflows {
		climsg.Info("Applying workflow: %s", w.Metadata.Name)
		result, err := workflow.Apply(&workflow.ApplyOptions{
			Workflow: w, OrgID: orgID, Conn: conn,
		})
		if err != nil {
			return nil, nil, errors.Wrapf(err, "failed to apply workflow %s", w.Metadata.Name)
		}
		refs = append(refs, buildResourceReference(result.Workflow.Metadata, apiresourcekind.ApiResourceKind_workflow))
	}

	for _, m := range synthResult.McpServers {
		climsg.Info("Applying MCP server: %s", m.Metadata.Name)
		result, err := mcpserver.Apply(&mcpserver.ApplyOptions{
			McpServer: m, OrgID: orgID, Conn: conn,
		})
		if err != nil {
			return nil, nil, errors.Wrapf(err, "failed to apply MCP server %s", m.Metadata.Name)
		}
		refs = append(refs, buildResourceReference(result.McpServer.Metadata, apiresourcekind.ApiResourceKind_mcp_server))
		appliedServers = append(appliedServers, result.McpServer)
	}

	return refs, appliedServers, nil
}

// discoverAppliedMcpServersSDK triggers best-effort discovery for MCP servers
// applied via the SDK synthesis path.
func discoverAppliedMcpServersSDK(servers []*mcpserverv1.McpServer, conn *grpc.ClientConn) {
	if len(servers) == 0 {
		return
	}

	climsg.Info("Discovering capabilities for %d applied MCP server(s)...", len(servers))

	for _, server := range servers {
		skipMsg, discoverErr := mcpserver.ConnectOne(context.Background(), &mcpserver.ConnectOneOptions{
			Conn:    conn,
			Server:  server,
			Timeout: 30 * time.Second,
		})

		name := server.Metadata.GetName()

		if skipMsg != "" {
			climsg.Warning("%s", skipMsg)
			continue
		}
		if discoverErr != nil {
			climsg.Warning("Discovery failed for %s: %v", name, discoverErr)
			continue
		}
		climsg.Success("Discovered capabilities for %s", name)
	}
}

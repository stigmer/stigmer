package root

import (
	"fmt"
	"os"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apikey"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpserver"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/project"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/skill"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/workflow"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

func deleteAgent(dctx *deleteContext) error {
	agentRes, err := agent.GetFromBackend(dctx.client, dctx.orgID, dctx.ref)
	if err != nil {
		return err
	}

	if !dctx.force {
		warn := clioutput.Warning("You are about to delete the following agent:")
		warn.AddSection("").
			Field("ID", agentRes.Metadata.Id).
			Field("Name", agentRes.Metadata.Name).
			Field("Slug", agentRes.Metadata.Slug).
			Field("Org", agentRes.Metadata.Org)
		warn.Hint("This action cannot be undone.")
		dctx.renderer.Render(warn)

		confirmed, err := dctx.confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := agent.Delete(&agent.DeleteOptions{
		AgentID: agentRes.Metadata.Id,
		Client:  dctx.client,
	})
	if err != nil {
		return err
	}

	out := clioutput.Success("Agent deleted successfully")
	out.AddSection("Deleted Agent").
		Field("ID", result.Agent.Metadata.Id).
		Field("Name", result.Agent.Metadata.Name).
		Field("Slug", result.Agent.Metadata.Slug)
	dctx.renderer.Render(out)
	return nil
}

func deleteWorkflow(dctx *deleteContext) error {
	workflowRes, err := workflow.GetFromBackend(dctx.client, dctx.orgID, dctx.ref)
	if err != nil {
		return err
	}

	if !dctx.force {
		warn := clioutput.Warning("You are about to delete the following workflow:")
		warn.AddSection("").
			Field("ID", workflowRes.Metadata.Id).
			Field("Name", workflowRes.Metadata.Name).
			Field("Slug", workflowRes.Metadata.Slug).
			Field("Org", workflowRes.Metadata.Org)
		warn.Hint("This action cannot be undone.")
		dctx.renderer.Render(warn)

		confirmed, err := dctx.confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := workflow.Delete(&workflow.DeleteOptions{
		WorkflowID: workflowRes.Metadata.Id,
		Client:     dctx.client,
	})
	if err != nil {
		return err
	}

	out := clioutput.Success("Workflow deleted successfully")
	out.AddSection("Deleted Workflow").
		Field("ID", result.Workflow.Metadata.Id).
		Field("Name", result.Workflow.Metadata.Name).
		Field("Slug", result.Workflow.Metadata.Slug)
	dctx.renderer.Render(out)
	return nil
}

func deleteMcpServer(dctx *deleteContext) error {
	mcpRes, err := mcpserver.GetFromBackend(dctx.client, dctx.orgID, dctx.ref)
	if err != nil {
		return err
	}

	if !dctx.force {
		warn := clioutput.Warning("You are about to delete the following MCP server:")
		warn.AddSection("").
			Field("ID", mcpRes.Metadata.Id).
			Field("Name", mcpRes.Metadata.Name).
			Field("Slug", mcpRes.Metadata.Slug).
			Field("Org", mcpRes.Metadata.Org)
		warn.Hint("This action cannot be undone.")
		dctx.renderer.Render(warn)

		confirmed, err := dctx.confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := mcpserver.Delete(&mcpserver.DeleteOptions{
		Reference: dctx.ref,
		OrgID:     dctx.orgID,
		Client:    dctx.client,
	})
	if err != nil {
		return err
	}

	out := clioutput.Success("MCP server deleted successfully")
	out.AddSection("Deleted MCP Server").
		Field("ID", result.McpServer.Metadata.Id).
		Field("Name", result.McpServer.Metadata.Name).
		Field("Slug", result.McpServer.Metadata.Slug)
	dctx.renderer.Render(out)
	return nil
}

func deleteProject(dctx *deleteContext) error {
	projectRes, err := project.GetFromBackend(dctx.client, dctx.orgID, dctx.ref)
	if err != nil {
		return err
	}

	if !dctx.force {
		warn := clioutput.Warning("You are about to delete the following project:")
		warn.AddSection("").
			Field("ID", projectRes.Metadata.Id).
			Field("Name", projectRes.Metadata.Name).
			Field("Slug", projectRes.Metadata.Slug).
			Field("Org", projectRes.Metadata.Org)
		warn.Hint("This action cannot be undone.")
		dctx.renderer.Render(warn)

		confirmed, err := dctx.confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := project.Delete(&project.DeleteOptions{
		ProjectID: projectRes.Metadata.Id,
		Client:    dctx.client,
	})
	if err != nil {
		return err
	}

	out := clioutput.Success("Project deleted successfully")
	out.AddSection("Deleted Project").
		Field("ID", result.Project.Metadata.Id).
		Field("Name", result.Project.Metadata.Name).
		Field("Slug", result.Project.Metadata.Slug)
	dctx.renderer.Render(out)
	return nil
}

func deleteSkill(dctx *deleteContext) error {
	skillRes, err := skill.GetFromBackend(dctx.client, dctx.orgID, dctx.ref)
	if err != nil {
		return err
	}

	if !dctx.force {
		warn := clioutput.Warning("You are about to delete the following skill:")
		sec := warn.AddSection("").
			Field("ID", skillRes.Metadata.Id).
			Field("Name", skillRes.Metadata.Name).
			Field("Slug", skillRes.Metadata.Slug).
			Field("Org", skillRes.Metadata.Org)
		if skillRes.Spec != nil && skillRes.Spec.Tag != "" {
			sec.Field("Tag", skillRes.Spec.Tag)
		}
		warn.Hint("This will delete the skill and all its versions.")
		warn.Hint("This action cannot be undone.")
		dctx.renderer.Render(warn)

		confirmed, err := dctx.confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := skill.Delete(&skill.DeleteOptions{
		SkillID: skillRes.Metadata.Id,
		Client:  dctx.client,
	})
	if err != nil {
		return err
	}

	out := clioutput.Success("Skill deleted successfully")
	out.AddSection("Deleted Skill").
		Field("ID", result.Skill.Metadata.Id).
		Field("Name", result.Skill.Metadata.Name).
		Field("Slug", result.Skill.Metadata.Slug)
	dctx.renderer.Render(out)
	return nil
}

func deleteApiKey(dctx *deleteContext) error {
	keyRes, err := apikey.GetFromBackend(dctx.client, dctx.ref)
	if err != nil {
		return err
	}

	if !dctx.force {
		warn := clioutput.Warning("You are about to delete the following API key:")
		sec := warn.AddSection("")
		sec.Field("ID", keyRes.GetMetadata().GetId())
		if keyRes.GetMetadata().GetName() != "" {
			sec.Field("Name", keyRes.GetMetadata().GetName())
		}
		if keyRes.GetSpec().GetFingerprint() != "" {
			sec.Field("Fingerprint", "***"+keyRes.GetSpec().GetFingerprint())
		}
		warn.Hint("This will permanently revoke the API key.")
		warn.Hint("This action cannot be undone.")
		dctx.renderer.Render(warn)

		confirmed, err := dctx.confirmer.Confirm("Proceed with deletion? [y/N]")
		if err != nil {
			return errors.Wrap(err, "failed to read confirmation")
		}
		if !confirmed {
			fmt.Fprintln(os.Stderr, "Aborted.")
			return nil
		}
	}

	result, err := apikey.Delete(&apikey.DeleteOptions{
		ApiKeyID: keyRes.GetMetadata().GetId(),
		Client:   dctx.client,
	})
	if err != nil {
		return err
	}

	out := clioutput.Success("API key deleted successfully")
	sec := out.AddSection("Deleted API Key")
	sec.Field("ID", result.ApiKey.GetMetadata().GetId())
	if result.ApiKey.GetMetadata().GetName() != "" {
		sec.Field("Name", result.ApiKey.GetMetadata().GetName())
	}
	dctx.renderer.Render(out)
	return nil
}

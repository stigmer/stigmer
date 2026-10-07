"""Credential inputs and a surface's credential assignments.

A credential belongs to a person or to its organization. The input declares
no second org: with no person set, the credential is the organization's,
named by the input's own ``org``; a set ``person`` holds the owner oneof. An
assignment's source is a credential's field or a plain literal, and its
requirement names the declarer through a target oneof whose git-host member
is a plain string.
"""

from __future__ import annotations

from stigmer import CredentialFieldInput, CredentialInput, CredentialTargetInput, ResourceRef
from stigmer._gen._agentchannel import (
    AgentChannelInput,
    CredentialAssignmentInput,
    CredentialFieldRefInput,
    RequirementRefInput,
)


class TestCredentialOwner:
    def test_no_person_makes_the_organizations_credential(self) -> None:
        proto = CredentialInput(
            name="Datadog",
            org="acme",
            fields={"DD_API_KEY": CredentialFieldInput(value="dd-secret")},
        )._to_proto()
        assert proto.spec.WhichOneof("owner") == "org"
        assert proto.spec.org == "acme"
        assert proto.metadata.org == "acme"
        assert proto.spec.fields["DD_API_KEY"].value == "dd-secret"

    def test_a_person_holds_the_owner(self) -> None:
        proto = CredentialInput(
            name="My GitHub token",
            org="acme",
            person="idac_ada",
            serves=[CredentialTargetInput(git_host="github.com")],
        )._to_proto()
        assert proto.spec.WhichOneof("owner") == "person"
        assert proto.spec.person == "idac_ada"
        assert proto.spec.serves[0].git_host == "github.com"


class TestCredentialAssignments:
    def test_field_and_literal_sources_reach_the_proto(self) -> None:
        proto = AgentChannelInput(
            name="support",
            org="acme",
            agent_ref=ResourceRef(org="acme", slug="support-bot"),
            credentials=[
                CredentialAssignmentInput(
                    requirement=RequirementRefInput(
                        declarer=CredentialTargetInput(
                            mcp_server=ResourceRef(org="acme", slug="github-mcp"),
                        ),
                        key="GITHUB_TOKEN",
                    ),
                    credential=CredentialFieldRefInput(
                        credential=ResourceRef(org="acme", slug="bot-token"),
                        field="GITHUB_TOKEN",
                    ),
                ),
                CredentialAssignmentInput(
                    requirement=RequirementRefInput(
                        declarer=CredentialTargetInput(git_host="github.com"),
                        key="GIT_USER",
                    ),
                    literal="stigmer-bot",
                ),
            ],
        )._to_proto()

        first, second = proto.spec.credentials
        assert first.requirement.declarer.mcp_server.slug == "github-mcp"
        assert first.WhichOneof("source") == "credential"
        assert first.credential.field == "GITHUB_TOKEN"
        assert first.credential.credential.slug == "bot-token"
        assert second.requirement.declarer.git_host == "github.com"
        assert second.WhichOneof("source") == "literal"
        assert second.literal == "stigmer-bot"

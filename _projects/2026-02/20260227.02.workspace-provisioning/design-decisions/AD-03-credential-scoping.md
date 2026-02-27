# AD-03: Credential Scoping -- Provisioning vs Agent Runtime

**Date**: 2026-02-27
**Status**: Accepted
**Context**: Workspace provisioning architecture discussion

## Decision

Credentials consumed by the workspace provisioning layer (e.g., `GITHUB_TOKEN` for git clone) are stripped from the environment before it is forwarded to the agent. The agent never sees provisioning-only credentials.

## Merge Chain

The provisioning layer resolves credentials from the same merge chain that exists for all environment variables:

```
Agent defaults < Environment (long-lived) < runtime_env/ExecutionContext (ephemeral)
```

This means `GITHUB_TOKEN` can come from either:
- **Environment** on the AgentInstance (for a fixed repo setup)
- **runtime_env** on the AgentExecution (for per-execution, ephemeral use)

Both must work. The provisioning layer doesn't care where the value came from.

## MVP: Explicit Consumption with Logging

For MVP, the provisioner declares which keys it consumed via `ProvisionResult.consumed_keys`. Each consumed key is logged explicitly:

```
Key 'GITHUB_TOKEN' consumed by workspace provisioning (git clone).
This key will not be forwarded to the agent runtime environment.
```

**Well-known consumed keys** (documented in proto and CLI help):
- `GITHUB_TOKEN` -- consumed by git clone, stripped from agent env

**Reserved prefix**: Keys starting with `WORKSPACE_PROVISION_` are reserved for provisioning and always stripped. This prefix is more specific than the original `WORKSPACE_` to reduce collision risk with user-defined keys.

**Workaround for dual-use**: If a user needs `GITHUB_TOKEN` for both provisioning AND agent runtime (e.g., an agent that creates GitHub issues), they should use separate keys: `GITHUB_TOKEN` for provisioning and `AGENT_GITHUB_TOKEN` (or any other name) for the agent.

## Future: CredentialScope Enum

```protobuf
message EnvironmentValue {
  string value = 1;
  bool is_secret = 2;
  string description = 3;
  CredentialScope scope = 4;  // AGENT, PROVISIONING, BOTH
}
```

And eventually, Vault-backed resolution:
```python
class VaultResolver:
    def resolve(self, key, env_data):
        ref = env_data[key].value
        if ref.startswith("vault:"):
            return self.vault_client.read(ref)
        return ref
```

## Consequences

- `ProvisionResult` returns `consumed_keys: list[str]` so the caller knows which keys to strip.
- The execution flow strips consumed keys AFTER provisioning, BEFORE agent creation.
- Security improvement: `GITHUB_TOKEN` is never exposed to the LLM or agent tools.

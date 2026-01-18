# Agent Runner Learning Log

## Purpose

This log captures all learnings, discoveries, and solutions from implementing and maintaining the agent-runner service. Organized by topic for easy lookup.

**Check this log BEFORE solving a problem** - the solution might already be documented!

---

## How to Use This Log

1. **Before implementing**: Search for your topic/error
2. **Found a solution**: Check if it's already documented
3. **New discovery**: Add it to the appropriate section
4. **Organized by topic**: Not chronological, easier to find

---

## Proto Imports & Stubs

### 2026-01-15 - Proto Validation: Required api_version and kind Fields

**Problem**: Validation error when sending AgentExecution to backend:
```
Input validation failed for agent_execution: 
api_version – value must equal `agentic.stigmer.ai/v1`
kind – value must equal `AgentExecution`
```

**Root Cause**: Proto messages sent to backend must always have `api_version` and `kind` fields populated. Backend validation middleware enforces these fields but they aren't automatically set when constructing proto messages in Python.

**Solution**: Always set these fields when creating proto messages to send to backend:
```python
# ❌ WRONG - Missing api_version and kind
execution_update = AgentExecution(
    metadata=ApiResourceMetadata(id=execution_id),
    status=status
)

# ✅ CORRECT - Include api_version and kind
execution_update = AgentExecution(
    api_version="agentic.stigmer.ai/v1",
    kind="AgentExecution",
    metadata=ApiResourceMetadata(id=execution_id),
    status=status
)
```

**Pattern for all API resources**:
- `api_version`: Follow format `{domain}/{version}` (e.g., `agentic.stigmer.ai/v1`)
- `kind`: Resource type name in PascalCase (e.g., `AgentExecution`, `Agent`, `Skill`)

**Prevention**: 
1. Always include these fields when constructing any API resource proto
2. Check proto definitions for the correct api_version format
3. Backend validation will reject messages without these fields

**Related**: This applies to all API resources (Agent, Skill, Environment, etc.), not just AgentExecution

### 2026-01-12 - Runtime Import Error: Wrong Enum Names

**Problem**: Runtime error `ImportError: cannot import name 'AgentExecutionPhase'`

**Root Cause**: Code was importing non-existent enum names. The actual enum is `ExecutionPhase` (not `AgentExecutionPhase`).

**Solution**: Check proto definitions and use correct names:
```python
# ❌ WRONG
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import AgentExecutionPhase

# ✅ CORRECT
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
```

**Prevention**: 
1. Always check the proto file to verify enum names
2. Use mypy type checking (catches these errors at build time)
3. Reference: `apis/ai/stigmer/agentic/agentexecution/v1/enum.proto`

**Related**: See "Type Checking Setup" below

### 2026-01-12 - Proto Enum Value Naming Convention

**Problem**: Using wrong enum value names (snake_case instead of SCREAMING_SNAKE_CASE)

**Root Cause**: Protobuf Python generates enum values in SCREAMING_SNAKE_CASE format

**Solution**: Use correct enum value format:
```python
# ❌ WRONG (snake_case with prefix)
ExecutionPhase.agent_execution_phase_in_progress

# ✅ CORRECT (SCREAMING_SNAKE_CASE without prefix)
ExecutionPhase.EXECUTION_IN_PROGRESS
```

**Pattern for all enums**:
```python
# Proto definition: EXECUTION_PENDING
ExecutionPhase.EXECUTION_PENDING  # ✅

# Proto definition: MESSAGE_AI
MessageType.MESSAGE_AI  # ✅

# Proto definition: TOOL_CALL_COMPLETED
ToolCallStatus.TOOL_CALL_COMPLETED  # ✅
```

**Prevention**: Always use SCREAMING_SNAKE_CASE for enum values

### 2026-01-12 - Proto Field Name Corrections

**Problem**: Using wrong field names causing AttributeError at runtime

**Common field name mistakes**:

| Wrong | Correct | Proto Message |
|-------|---------|---------------|
| `message.tool_call` | `message.tool_calls` | AgentMessage (repeated) |
| `agent.spec.config` | `agent.spec.instructions` | AgentSpec |
| `skill.spec.content` | `skill.spec.markdown_content` | SkillSpec |
| `env.spec.vars` | `env.spec.data` | EnvironmentSpec |
| `execution.metadata.env` | N/A (doesn't exist) | ApiResourceMetadata |

**Solution**: Always verify field names in proto definitions before using

**Prevention**: Use mypy type checking - catches AttributeError at build time

### 2026-01-12 - Initial Service Setup

**Problem**: Setting up proto stubs for agent-runner service

**Solution**: Proto stubs need to be generated and added to PYTHONPATH:
```bash
# Generate stubs
buf generate apis/ai/stigmer

# Verify stubs
ls -la apis/stubs/python/stigmer/
```

**Import Pattern**:
```python
from ai.stigmer.agentic.agent.v1 import query_pb2_grpc
from ai.stigmer.agentic.agent.v1.api_pb2 import Agent
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecution
```

**Prevention**: Always verify stubs exist before starting implementation.

---

## Temporal Activities

### 2026-01-12 - Activity Registration Pattern

**Problem**: Need to register activities in worker

**Solution**: Import and add to activities list in worker:
```python
# worker/worker.py
from worker.activities.execute_graphton import execute_graphton

self.worker = Worker(
    self.client,
    task_queue=self.config.task_queue,
    activities=[
        execute_graphton,
        # ... other activities
    ],
)
```

**Prevention**: Update worker registration when adding new activities.

---

## gRPC Clients

### 2026-01-14 - Empty ID Validation Pattern

**Problem**: Passing empty string IDs to backend gRPC services caused cryptic errors:
```
"Resource ID must be set before loading resource"
```

**Root Cause**: Proto3 strings default to empty string (`""`) rather than null. When `session_id`, `execution_id`, or other ID fields weren't set, they appeared as empty strings. These empty strings were passed directly to gRPC calls, which the backend rejected during validation.

**Why This Happens**:
```python
# Proto3 behavior
execution = AgentExecution()
print(execution.spec.session_id)  # Prints: "" (not None!)

# Easy to miss validation
session = await session_client.get(execution.spec.session_id)  
# ❌ Passes "" to backend → cryptic error
```

**Solution**: Add client-side validation before making gRPC calls:

```python
async def get(self, session_id: str) -> Session:
    """Fetch session by ID."""
    if not session_id:
        raise ValueError("session_id cannot be empty")
    request = SessionId(value=session_id)
    return await self.query_stub.get(request)
```

**Apply to ALL gRPC clients**:
```python
# execution_client.py
if not execution_id:
    raise ValueError("execution_id cannot be empty")

# session_client.py
if not session_id:
    raise ValueError("session_id cannot be empty")

# agent_instance_client.py
if not agent_instance_id:
    raise ValueError("agent_instance_id cannot be empty")

# agent_client.py
if not agent_id:
    raise ValueError("agent_id cannot be empty")
```

**Benefits**:
- ✅ Clear error messages: "session_id cannot be empty" vs "Resource ID must be set"
- ✅ Fails fast at Python layer (before gRPC call)
- ✅ Easier debugging - knows which field is missing
- ✅ Consistent validation across all clients

**Activity-Level Validation**:
For critical paths, add validation at the activity level too:
```python
@activity.defn(name="ExecuteGraphton")
async def execute_graphton(execution: AgentExecution, thread_id: str):
    session_id = execution.spec.session_id
    if not session_id:
        raise ValueError(
            f"Session ID is required for execution {execution.metadata.id}. "
            "Execution must have a valid session_id to proceed."
        )
    
    # Now safe to fetch
    session = await session_client.get(session_id)
```

**Prevention**:
1. Always validate proto string fields before using as IDs
2. Use `if not field_value:` to catch both empty string and None
3. Provide context-specific error messages
4. Fail fast at the system boundary (gRPC client layer)

**Related**: Proto3 field defaults documented in "Proto Imports & Stubs" section

### 2026-01-14 - Machine Account vs User Token Authentication (CRITICAL)

**Problem**: Agent-runner was attempting to retrieve and use user JWT tokens from Redis, but all gRPC clients were already correctly using machine account tokens. This led to "User token not found in Redis" errors and 200+ lines of dead code.

**Root Cause**: Architectural misunderstanding about which token should be used:
- ❌ **Wrong assumption**: "Agent-runner needs user token to make gRPC calls"
- ✅ **Correct pattern**: "Agent-runner is an internal service, uses machine account"

**The Dead Code Pattern**:
```python
# Retrieve user token from Redis (never stored, always fails)
user_token = token_service.get_user_token(execution_id)

# Use machine account for ALL gRPC calls (correct!)
execution_client = ExecutionClient(token_manager)  # ← Machine account!
session_client = SessionClient(token_manager)      # ← Machine account!
agent_client = AgentClient(token_manager)          # ← Machine account!

# user_token NEVER USED! Dead variable for entire function!
```

**Solution**: Remove all user token retrieval code. Agent-runner should **ONLY** use machine account authentication.

**Correct Architecture**:
```
User Request → stigmer-service
                 ↓
        User JWT validated here
        FGA authorization check
        Execution created (with user/org metadata)
                 ↓
        Temporal workflow started
                 ↓
        Agent-Runner (Python)
           • Authenticates with MACHINE ACCOUNT token ✅
           • Makes gRPC calls to stigmer-service
           • stigmer-service validates machine account ✅
           • stigmer-service checks FGA using execution metadata ✅
           • Works perfectly!
```

**Why Machine Account is Correct**:

1. **Separation of Concerns**:
   - User authentication: API gateway (stigmer-service)
   - Service authentication: Machine accounts
   - Authorization: FGA checks using execution metadata

2. **Security Benefits**:
   - User tokens don't sit in Redis
   - No token expiration issues (machine tokens auto-rotated)
   - Proper auth separation (user vs service)

3. **Authorization via Metadata**:
   - Execution record contains `user_id` and `org_id`
   - FGA tuples: `agent_execution:<exec_id>#session@session:<session_id>`
   - stigmer-service validates: "Does this execution belong to this session?"
   - No user token needed!

**Example Flow**:
```python
# Agent-runner calls session_client.get(session_id)
# 1. Sends gRPC request with MACHINE ACCOUNT token
# 2. stigmer-service validates machine account ✅
# 3. stigmer-service loads execution from DB
# 4. Checks FGA: execution metadata (user/org) vs session metadata
# 5. Returns session if authorized, else PERMISSION_DENIED
```

**What NOT to Do**:
- ❌ Don't try to pass user tokens via Redis
- ❌ Don't create UserTokenInterceptor for agent-runner
- ❌ Don't store user tokens for background workers
- ❌ Don't use user tokens in internal services

**What TO Do**:
- ✅ Use machine account tokens for all agent-runner gRPC calls
- ✅ Store user context in execution metadata (user_id, org_id)
- ✅ Let stigmer-service handle authorization via FGA
- ✅ Trust the machine account + metadata pattern

**Prevention**:
1. Remember: Agent-runner is an **internal service**, not a user client
2. Internal services authenticate as themselves (machine accounts)
3. User context flows through **data** (execution metadata), not **auth tokens**
4. Authorization happens at stigmer-service using FGA + metadata

**Related Docs**: 
- See "Client Authentication Pattern" below for machine account usage
- See "Token Manager Setup" for machine account token rotation

**Impact**: Removed 200+ lines of dead code, fixed all "token not found" errors, clarified architecture

### 2026-01-12 - Client Authentication Pattern

**Problem**: gRPC clients need machine account authentication

**Solution**: Use AuthClientInterceptor pattern:
```python
from grpc_client.auth.client_interceptor import AuthClientInterceptor

interceptor = AuthClientInterceptor(token_manager)

if endpoint.endswith(":443"):
    channel = grpc.aio.secure_channel(
        endpoint,
        grpc.ssl_channel_credentials(),
        interceptors=[interceptor]
    )
else:
    channel = grpc.aio.insecure_channel(
        endpoint,
        interceptors=[interceptor]
    )
```

**Prevention**: Always create clients with token manager and interceptor.

### 2026-01-15 - Simplify Authentication from Auth0 Machine Account to Stigmer API Key

**Problem**: Agent-runner used complex Auth0 machine account authentication for gRPC calls to stigmer-service, introducing significant complexity:
- 163-line `MachineAccountTokenManager` class for JWT token fetching, caching, and validation
- Background asyncio task for token rotation (checking every 10 minutes)
- Startup overhead (had to fetch initial token from Auth0 before worker could start)
- External Auth0 dependency and potential connectivity failures
- Multiple environment variables (client_id, client_secret, domain, audience)

**Root Cause**: Over-engineering service-to-service authentication. For internal services like agent-runner, a static API key provides equivalent security without the complexity.

**Solution**: Replace Auth0 machine account with simple Stigmer API key authentication:

**1. Configuration Changes:**

Create new configuration groups:
```yaml
# _ops/planton/service-hub/secrets-group/stigmer-api.yaml
apiVersion: service-hub.planton.ai/v1
kind: SecretsGroup
metadata:
  name: stigmer-api
spec:
  entries:
    - name: prod.api-key
      value: stk_lmwwB9JvKuS7jsQUwm6uFV9XloliXlqpXUZVQA6HmxQ

# _ops/planton/service-hub/variables-group/stigmer-api.yaml
apiVersion: service-hub.planton.ai/v1
kind: VariablesGroup
metadata:
  name: stigmer-api
spec:
  entries:
    - name: prod.endpoint
      value: stigmer-prod-api.planton.live
```

Update service configuration:
```yaml
# backend/services/agent-runner/_kustomize/overlays/prod/service.yaml
env:
  variables:
    STIGMER_BACKEND_ENDPOINT:
      value: $variables-group/stigmer-api/prod.endpoint
  secrets:
    STIGMER_API_KEY:
      value: $secrets-group/stigmer-api/prod.api-key
    # REMOVED: MACHINE_ACCOUNT_CLIENT_ID, MACHINE_ACCOUNT_CLIENT_SECRET
```

**2. Code Simplification:**

Simplify config.py:
```python
# worker/config.py - BEFORE (Auth0)
@dataclass
class Config:
    auth0_domain: str
    auth0_audience: str
    machine_account_client_id: str
    machine_account_client_secret: str
    # ... validation for all 4 fields

# worker/config.py - AFTER (API Key)
@dataclass
class Config:
    stigmer_api_key: str
    # Single field, single validation
```

Simplify interceptor:
```python
# grpc_client/auth/client_interceptor.py - BEFORE
class AuthClientInterceptor:
    def __init__(self, token_manager: MachineAccountTokenManager):
        self.token_manager = token_manager
    
    async def intercept_unary_unary(self, continuation, client_call_details, request):
        await self.token_manager.get_token()  # Async token fetch
        new_details = self._augment_call_details(client_call_details)
        return await continuation(new_details, request)

# grpc_client/auth/client_interceptor.py - AFTER
class AuthClientInterceptor:
    def __init__(self, api_key: str):
        self.api_key = api_key
    
    async def intercept_unary_unary(self, continuation, client_call_details, request):
        new_details = self._augment_call_details(client_call_details)  # Direct use
        return await continuation(new_details, request)
```

Simplify worker initialization:
```python
# worker/worker.py - BEFORE (Auth0)
class AgentRunner:
    def __init__(self, config: Config):
        # Initialize token manager
        self.token_manager = MachineAccountTokenManager(
            auth0_domain=config.auth0_domain,
            auth0_audience=config.auth0_audience,
            client_id=config.machine_account_client_id,
            client_secret=config.machine_account_client_secret,
        )
        set_token_manager(self.token_manager)
        self.rotation_task: Optional[asyncio.Task[None]] = None
    
    async def register_activities(self):
        # Fetch initial token from Auth0
        await self.token_manager.get_token()
        # Start token rotation background task
        self.rotation_task = asyncio.create_task(self._token_rotation_loop())
    
    async def _token_rotation_loop(self):
        while True:
            await asyncio.sleep(600)  # Check every 10 minutes
            await self.token_manager.rotate_token()

# worker/worker.py - AFTER (API Key)
class AgentRunner:
    def __init__(self, config: Config):
        set_api_key(config.stigmer_api_key)
    
    async def register_activities(self):
        # No token fetch, no rotation task - just connect and register
        pass
```

Update all gRPC clients:
```python
# Before: All clients took token_manager
class AgentExecutionClient:
    def __init__(self, token_manager: MachineAccountTokenManager):
        interceptor = AuthClientInterceptor(token_manager)

# After: All clients take api_key
class AgentExecutionClient:
    def __init__(self, api_key: str):
        interceptor = AuthClientInterceptor(api_key)
```

Update activities:
```python
# worker/activities/execute_graphton.py - BEFORE
token_manager = get_token_manager()
execution_client = AgentExecutionClient(token_manager)
session_client = SessionClient(token_manager)

# worker/activities/execute_graphton.py - AFTER
api_key = get_api_key()
execution_client = AgentExecutionClient(api_key)
session_client = SessionClient(api_key)
```

**3. Delete Unnecessary Code:**
- `grpc_client/auth/token_manager.py` (163 lines deleted - no longer needed)

**Benefits:**

**Code Simplification:**
- Removed ~200 lines of token management code
- Eliminated async complexity (token rotation background task)
- Simplified imports (no httpx, jwt, Auth0 dependencies needed)

**Operational:**
- Faster startup (no Auth0 token fetch - saves 500-1000ms)
- No token rotation task (eliminates background asyncio overhead)
- Fewer failure modes (no Auth0 connectivity issues)
- Simpler configuration (1 secret vs 4 Auth0 variables)

**Security:**
- Equivalent security level (API key provides same authentication as machine account JWT)
- Simpler key rotation (single API key to rotate vs multiple Auth0 credentials)
- No external dependencies (no reliance on Auth0 availability)

**Prevention:**
1. For internal service-to-service authentication, prefer static API keys over OAuth2 machine accounts
2. Reserve OAuth2/JWT complexity for user-facing authentication or when short-lived tokens are required
3. API keys are appropriate when:
   - Both services are in the same trust domain
   - Key rotation is acceptable (no need for automatic expiry)
   - Simplicity and reliability are priorities
4. Always use API keys in Bearer token format: `Authorization: Bearer <key>`

**When to Use Each Pattern:**

**Use API Key (Simpler):**
- ✅ Internal service-to-service calls (same trust domain)
- ✅ Background workers calling backend APIs
- ✅ Long-running services (no token expiry issues)
- ✅ When simplicity and reliability are priorities

**Use OAuth2 Machine Account (More Complex):**
- ⚠️ Cross-organization service calls
- ⚠️ When short-lived tokens are security requirement
- ⚠️ When automatic token expiry is needed
- ⚠️ External third-party integrations

**Related Docs:**
- See "Machine Account vs User Token Authentication" above for authentication architecture
- See changelog: `_changelog/2026-01/2026-01-15-213945-simplify-agent-runner-auth-to-stigmer-api-key.md`

**Reusability:** This same pattern should be applied to **workflow-runner** service, which also uses Auth0 machine account authentication. The refactoring will be identical.

**Impact:** Removed ~200 lines of code, eliminated background tasks, simplified configuration, faster startup, fewer failure modes

---

## Sandbox Management

### 2026-01-12 - Session-Based Reuse Pattern

**Problem**: Sandboxes should be reused across session turns

**Solution**: Store sandbox_id in SessionSpec:
```python
sandbox, is_new = await sandbox_manager.get_or_create_sandbox(
    sandbox_config={"type": "daytona"},
    session_id=session_id,
    session_client=session_client,
)

# sandbox_manager handles:
# 1. Check session for existing sandbox_id
# 2. Health check existing sandbox
# 3. Fallback to new sandbox if unhealthy
# 4. Store new sandbox_id in session
```

**Prevention**: Always pass session_id and session_client for reuse.

---

## Graphton Agent Creation

### 2026-01-12 - Sandbox Reuse in Agent Creation

**Problem**: Graphton agent needs to reuse existing sandbox with skills

**Solution**: Pass sandbox_id in sandbox_config:
```python
sandbox_config = {
    "type": "daytona",
    "sandbox_id": sandbox.id,  # Reuse existing sandbox
}

agent_graph = create_deep_agent(
    model="claude-sonnet-4.5",
    system_prompt=enhanced_prompt,
    sandbox_config=sandbox_config,
    recursion_limit=1000,
)
```

**Prevention**: Always pass sandbox_id to reuse, not just type.

---

## Skills Integration

### 2026-01-12 - Progressive Disclosure Pattern

**Problem**: Including full skill content in prompt wastes tokens

**Solution**: Use progressive disclosure:
1. Write skills to `/workspace/skills/*.md`
2. Include only metadata in system prompt
3. Agent reads full content with `read_file` tool when needed

```python
from worker.activities.graphton.skill_writer import SkillWriter

# Write skills to sandbox
skill_writer = SkillWriter(sandbox=sandbox)
skill_paths = skill_writer.write_skills(skills)

# Generate prompt with metadata only
skills_prompt = SkillWriter.generate_prompt_section(skills, skill_paths)

# Enhance system prompt
enhanced_prompt = base_instructions + skills_prompt
```

**Prevention**: Never include full skill content in system prompt.

---

## Token Management

### 2026-01-12 - User Token One-Time Use

**Problem**: User tokens from Redis must be deleted after use

**Solution**: TokenService handles one-time use automatically:
```python
token_service = TokenService(redis_client)
user_token = token_service.get_user_token(execution_id)
# Token is automatically deleted from Redis after fetch
```

**Prevention**: Always use TokenService, don't manually fetch from Redis.

---

## Logging & Developer Experience

### 2026-01-14 - Suppress Excessive Third-Party Debug Logs

**Problem**: Agent-runner logs were flooded with excessive debug messages from gRPC and Temporalio, making it difficult to identify actual issues.

**Symptoms**:
```
2026-01-14 18:07:07,202 - grpc._cython.cygrpc - DEBUG - [_cygrpc] Loaded running loop: id(loop)=4506202000
2026-01-14 18:07:07,202 - grpc._cython.cygrpc - DEBUG - [_cygrpc] Loaded running loop: id(loop)=4506202000
2026-01-14 18:07:07,202 - grpc._cython.cygrpc - DEBUG - [_cygrpc] Loaded running loop: id(loop)=4506202000
[... hundreds more lines ...]
```

**Root Cause**: Third-party libraries (gRPC, Temporalio) emit verbose debug logs by default, overwhelming useful application logs.

**Solution**: Selective logging suppression in `main.py`:

```python
# Configure logging
log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
log_level = getattr(logging, log_level_str, logging.INFO)

logging.basicConfig(
    level=log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Suppress noisy third-party library DEBUG logs
logging.getLogger("asyncio").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.INFO)

# Suppress excessive gRPC debug logs (NEW)
logging.getLogger("grpc").setLevel(logging.WARNING)
logging.getLogger("grpc._cython.cygrpc").setLevel(logging.WARNING)

# Suppress temporalio debug logs (keep INFO for activity lifecycle)
logging.getLogger("temporalio.worker._activity").setLevel(logging.INFO)
logging.getLogger("temporalio.activity").setLevel(logging.INFO)
```

**Benefits**:
- ✅ Clean logs with relevant information only
- ✅ Easy to identify issues (signal vs noise)
- ✅ Preserves important lifecycle events (activity start/complete)
- ✅ Performance improvement (less log I/O)

**What to Suppress**:
| Logger | Level | Reason |
|--------|-------|--------|
| `grpc._cython.cygrpc` | WARNING | Internal loop mechanics |
| `grpc` | WARNING | Protocol-level details |
| `temporalio.worker._activity` | INFO | Keep lifecycle, suppress internal details |
| `temporalio.activity` | INFO | Keep activity logs, suppress verbose events |

**What to Keep**:
- Application-level logs (INFO and above)
- Activity start/complete events
- Error messages and warnings
- Important lifecycle transitions

**Pattern for Other Services**:
Apply same approach to any Python service using gRPC or Temporal:
1. Identify noisy loggers (check logs in dev environment)
2. Suppress at WARNING level (keeps errors visible)
3. Keep INFO for application-critical events
4. Document suppressions in main.py

**Prevention**: Always configure logging suppressions early in service setup

### 2026-01-14 - Debug Logging at System Boundaries

**Problem**: When debugging distributed systems (Python ↔ Java ↔ Temporal), it's hard to identify where data gets lost or corrupted.

**Solution**: Add parameter logging at system boundaries (where data crosses services):

```python
@activity.defn(name="ExecuteGraphton")
async def execute_graphton(execution: AgentExecution, thread_id: str):
    execution_id = execution.metadata.id
    agent_id = execution.spec.agent_id
    session_id_from_spec = execution.spec.session_id
    
    activity_logger = activity.logger
    
    # Log parameters at entry point (system boundary)
    activity_logger.info(
        f"Execution parameters: agent_id={agent_id}, "
        f"session_id='{session_id_from_spec}' (empty={not session_id_from_spec})"
    )
```

**Benefits**:
- ✅ Shows exact values at system entry
- ✅ Identifies if issue is upstream (Java/Temporal) or downstream (Python)
- ✅ Empty string visibility: `session_id='' (empty=True)`
- ✅ Quick troubleshooting: "Is data reaching Python correctly?"

**When to Use**:
- Temporal activities (data from workflow)
- gRPC handlers (data from clients)
- Event processors (data from queues)
- Any service boundary crossing

**Pattern**:
```python
# At system boundary: log INPUTS
logger.info(f"Parameters: field1={value1}, field2='{value2}' (empty={not value2})")

# After processing: log KEY STATE CHANGES
logger.info(f"Created resource: {resource_id}")

# Before return: log OUTPUTS
logger.info(f"Returning result: status={status}")
```

**Prevention**: Add boundary logging during initial development, not after issues arise

---

## Error Handling

### 2026-01-12 - Update Execution Before Re-raising

**Problem**: Activity failures don't update execution status

**Solution**: Update execution status before re-raising:
```python
try:
    result = await some_operation()
except Exception as e:
    logger.error(f"Operation failed: {e}")
    
    # Update execution with error
    try:
        await execution_client.add_error_message(execution_id, str(e))
        await execution_client.update_phase(
            execution_id,
            AgentExecutionPhase.agent_execution_phase_failed
        )
    except Exception as update_error:
        logger.error(f"Failed to update execution: {update_error}")
    
    # Re-raise original error
    raise
```

**Prevention**: Always wrap operations in try/except with status updates.

---

## Configuration

### 2026-01-12 - Environment Variable Validation

**Problem**: Missing environment variables cause cryptic errors

**Solution**: Validate required variables on config load:
```python
@classmethod
def load_from_env(cls):
    required = [
        "AUTH0_DOMAIN",
        "AUTH0_AUDIENCE",
        "MACHINE_ACCOUNT_CLIENT_ID",
        "MACHINE_ACCOUNT_CLIENT_SECRET",
    ]
    
    missing = [var for var in required if not os.getenv(var)]
    if missing:
        raise ValueError(f"Missing required env vars: {', '.join(missing)}")
    
    return cls(...)
```

**Prevention**: Validate all required config on startup.

### 2026-01-15 - Environment Variable Loading with python-dotenv

**Problem**: Agent-runner required shell script wrapper (`scripts/run-with-env.sh`) to load environment variables from `.env` files for local development. This created inconsistency with other services and added unnecessary complexity. Additionally, the shell script approach wasn't the industry-standard pattern for Python applications.

**Root Cause**:
- Environment variables needed for local development (`.env` file) weren't being loaded automatically
- Direct Poetry run (`poetry run python main.py`) didn't source `.env` files
- Original solution used shell scripts, but this:
  - Added maintenance overhead (separate script per service)
  - Wasn't industry-standard for Python applications
  - Inconsistent with stigmer-service (Spring Boot) and workflow-runner (godotenv)
- No automatic environment loading in the Python code itself

**Solution**: Add `python-dotenv` library and load `.env` automatically in `main.py`:

**Step 1**: Add python-dotenv to dependencies in `pyproject.toml`:
```toml
[tool.poetry.dependencies]
python = ">=3.11,<4.0"
# ... other dependencies
python-dotenv = "^1.0.0"
```

**Step 2**: Add environment loading at top of `main.py` (before any config loading):
```python
"""Entry point for agent-runner service."""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from dotenv import load_dotenv
from worker.worker import AgentRunner
from worker.config import Config
from worker.logging_config import setup_logging

# Load .env file for local development (optional - fails silently in production)
def load_env_file():
    """Load environment variables from .env file if it exists."""
    # Try current directory first
    env_path = Path(".env")
    if env_path.exists():
        load_dotenv(env_path)
        return
    
    # Try relative to this file
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        return
    
    # No .env file found - expected in production
    # Environment variables will come from Kubernetes ConfigMaps/Secrets

load_env_file()

# Configure logging (now with loaded environment)
setup_logging()
logger = logging.getLogger(__name__)
# ... rest of main.py
```

**Step 3**: Update launch configuration to run directly with Poetry:
```xml
<!-- .run/agent-runner.launch.run.xml -->
<configuration name="agent-runner.launch" type="ShConfigurationType">
  <option name="SCRIPT_TEXT" value="cd $PROJECT_DIR$ &amp;&amp; cd backend/services/agent-runner &amp;&amp; poetry run python main.py" />
  <option name="EXECUTE_IN_TERMINAL" value="true" />
</configuration>
```

**Step 4**: Delete shell script wrapper (no longer needed):
```bash
rm backend/services/agent-runner/scripts/run-with-env.sh
```

**Benefits**:
- ✅ **Industry standard**: Uses `python-dotenv` (8k+ stars, widely adopted in Python projects)
- ✅ **Automatic loading**: No manual sourcing required
- ✅ **Production-safe**: Optional loading, graceful fallback to system environment
- ✅ **Consistent pattern**: Matches stigmer-service (Spring Boot optional .env) and workflow-runner (godotenv)
- ✅ **Flexible**: Tries multiple paths (current dir, relative to main.py)
- ✅ **Clean**: Removes need for shell script wrapper

**Pattern Across Services**:

| Service | Language | Library | Pattern |
|---------|----------|---------|---------|
| stigmer-service | Java | Spring Boot | `spring.config.import: optional:file:.env` |
| workflow-runner | Go | godotenv | `env.Load()` in main |
| agent-runner | Python | python-dotenv | `load_dotenv()` in main |

**Development Workflow**:
```bash
# Step 1: Generate/update .env file
bazel run //backend/services/agent-runner:dot_env_local

# Step 2: Launch service (automatically loads .env)
cd backend/services/agent-runner
poetry run python main.py

# OR click "agent-runner.launch" in IntelliJ
```

**Production Workflow**: No changes needed - service runs the same way but gets environment variables from Kubernetes ConfigMaps/Secrets (no `.env` file).

**Prevention**: When implementing environment loading for any Python service:
1. Add `python-dotenv` to dependencies
2. Load at top of main entry point (before any imports that use env vars)
3. Try multiple paths for flexibility
4. Fail silently if `.env` not found (expected in production)
5. Don't use shell script wrappers (not industry-standard for Python)
6. Document pattern in comments

**Files Modified**:
- `backend/services/agent-runner/main.py` (added load_env_file function)
- `backend/services/agent-runner/pyproject.toml` (added python-dotenv dependency)
- `.run/agent-runner.launch.run.xml` (simplified to Poetry run)

**Files Deleted**:
- `backend/services/agent-runner/scripts/run-with-env.sh`

**Common Mistakes to Avoid**:
- ❌ Using shell scripts to load environment (not Python-idiomatic)
- ❌ Forgetting to call load_dotenv() before config loading
- ❌ Loading after imports that depend on environment variables
- ❌ Failing loudly when .env missing (breaks production deployments)
- ❌ Not trying multiple paths (inflexible for different execution contexts)
- ❌ Using deprecated python-decouple instead of python-dotenv

**Related**: 
- workflow-runner godotenv implementation (2026-01-15)
- stigmer-service Spring Boot pattern
- Industry-standard Python environment loading

---

## Event Streaming

### 2026-01-15 - Agent Execution Status Fields Not Populating

**Problem**: Agent execution status fields (tool_calls[], sub_agent_executions[], todos) were empty during and after execution, despite tool calls executing successfully. Frontend only saw messages[] updates.

**Root Cause**: When agent-runner was initially created from Planton Cloud's agent-fleet-worker, 87% of the event processing logic was not ported:
- `execution_client.py` had only 233 lines vs 1790 lines in source
- Missing: Dual tracking (messages[] AND tool_calls[])
- Missing: Sub-agent execution tracking  
- Missing: Todo update handling
- Missing: Component metadata for UI rendering
- Missing: Namespace routing for sub-agents
- Missing: Planning tools filtering

**Solution**: Port complete event processing logic from Planton Cloud:

**Phase 1 - Enhanced Event Handlers**:

1. **_handle_tool_start_event** (expanded from 40 to 170 lines):
   - Filter planning tools (write_todos) - handle separately
   - Transform tool names for UX ("execute" → "kubectl get")
   - Infer component type for UI rendering
   - Create ComponentMetadata proto with context
   - Route by namespace (main agent vs sub-agents)
   - Detect sub-agent spawning (task tool)
   - **CRITICAL**: Add to BOTH messages[] AND tool_calls[] lists

2. **_handle_tool_end_event** (expanded from 30 to 75 lines):
   - Skip planning tools (already handled)
   - Update tool calls in BOTH lists
   - Update SubAgentExecution status for task tools
   - Extract meaningful content from structured results

3. **_handle_chat_model_stream_event** (expanded from 45 to 70 lines):
   - Handle namespace context
   - Extract tokens from multimodal content blocks
   - Support various chunk formats

**Phase 2 - Helper Methods**:
- `_unwrap_tool_args()` - Remove LangGraph wrappers
- `_get_tool_fingerprint()` - Deduplicate dual stream events
- `_extract_tool_result_content()` - Parse structured results
- `_update_todos()` - Handle todo list updates
- `_extract_string_content()` - Extract text from multimodal blocks

**Phase 3 - Supporting Modules**:
- `worker/component_type_inference.py` - Map tool names to UI component types
- `worker/command_parser.py` - Transform execute commands for display

**Key Learning**: Tool calls must be in BOTH places:
```python
# ❌ WRONG (original code)
execution.status.messages.append(tool_message)  # Only in messages[]

# ✅ CORRECT (fixed code)
execution.status.messages.append(tool_message)  # Conversation flow
execution.status.tool_calls.append(tool_call)   # Separate tracking for UI!
```

**Why Dual Tracking**:
- `messages[]` = conversation flow (AI → Tool → AI → Tool...)
- `tool_calls[]` = all tool calls for querying, filtering, UI display
- Frontend queries `tool_calls[]` specifically, not `messages[]`

**Impact After Fix**:
- ✅ Tool calls visible in UI with status updates
- ✅ Sub-agent executions tracked
- ✅ Todo list updates working
- ✅ Component metadata drives UI rendering
- ✅ Result content extracted from structured data

**Prevention**:
1. When porting code, compare line counts between source and target
2. If massive size difference (233 vs 1790 lines), investigate missing functionality
3. Don't assume "simplification" - verify all features are intentionally excluded
4. Test ALL status fields after porting, not just basic execution
5. Silent data loss (no errors) is harder to catch than exceptions

**Reference**: 
- Fixed files: `grpc_client/execution_client.py`, `worker/component_type_inference.py`, `worker/command_parser.py`
- Project docs: `_projects/2026-01/20260110.02.agent-execution-service/`
- Analysis docs: `_docs/agent-execution-*-analysis.md`

---

### 2026-01-12 - astream_events v2 Pattern

**Problem**: Need to process Graphton execution events

**Solution**: Use astream_events with v2 schema:
```python
async for event in agent_graph.astream_events(
    langgraph_input,
    config=config,
    version="v2",  # Use v2 for consistent event structure
):
    await execution_client.update_from_event(execution_id, event)
```

**Prevention**: Always use version="v2" for consistent event handling.

---

## Deployment

### 2026-01-12 - Docker Build Context

**Problem**: Docker build needs repo root as context for path deps

**Solution**: Build from repo root:
```bash
# Correct (from repo root)
docker build -f backend/services/agent-runner/Dockerfile -t agent-runner .

# Wrong (from service dir)
docker build -t agent-runner .  # Path deps won't resolve
```

**Prevention**: Always build from repo root with -f flag.

---

## Type Checking & Build Validation

### 2026-01-12 - Type Checking Implementation with mypy

**Problem**: Runtime import and type errors not caught until production deployment

**Root Cause**: No build-time validation for Python services (unlike Java/Go compile-time checks)

**Solution**: Add type checking via Makefile build target:

**1. Create Makefile**:
```makefile
.PHONY: build
build:
	@echo "Running type checking..."
	cd $(repo_root)/backend/services/agent-runner && \
		poetry install --no-interaction && \
		poetry run mypy grpc_client/ worker/ --show-error-codes
	@echo "✅ Type checking passed"
```

**2. Enable type checking in pyproject.toml**:
```toml
# Remove or comment out:
# [[tool.mypy.overrides]]
# module = "worker.*"
# ignore_errors = true
```

**3. CI/CD integration** (automatic):
Existing `tools/ci/build_and_push_service.sh` checks for `make build`:
```bash
if [[ -f "${service_root}/Makefile" ]] && grep -qE '^build:' "${service_root}/Makefile"; then
  make -C "${service_root}" build  # Runs type checking
fi
```

**Benefits**:
- ✅ Catches import errors at build time (not runtime)
- ✅ Validates enum usage and field names
- ✅ No CI/CD changes needed (automatic pickup)
- ✅ Fast feedback (3-4 seconds locally)

**Prevention**: Always add `make build` target with mypy for Python services

**Pattern Source**: Planton Cloud `agent-fleet-worker` (same pattern, same problem solved)

**Reference**: `backend/services/agent-runner/docs/implementation/type-checking.md`

---

## Architecture & Data Model

### 2026-01-12 - AgentInstance Architecture Implementation

**Problem**: Code tried to fetch agent directly from execution - missing deployment layer

**Root Cause**: Misunderstanding of resource hierarchy

**Correct Architecture**:
```
Agent (template)
    ↓ agent_id
AgentInstance (deployment with environments)
    ↓ agent_instance_id
Session (conversation with sandbox)
    ↓ session_id
AgentExecution (single turn)
```

**Solution**: Implement full resolution chain:

```python
# 1. Get session from execution
session = await session_client.get(execution.spec.session_id)

# 2. Get agent instance from session
agent_instance = await agent_instance_client.get(session.spec.agent_instance_id)

# 3. Get agent template from instance
agent = await agent_client.get(agent_instance.spec.agent_id)

# 4. Get skills from agent (via ApiResourceReference)
skill_refs = agent.spec.skill_refs
skills = await skill_client.list_by_refs(skill_refs)

# 5. Get environments from instance (via ApiResourceReference)
environment_refs = agent_instance.spec.environment_refs
environments = await environment_client.list_by_refs(environment_refs)
```

**New Clients Created**:
- `AgentInstanceClient` - Fetch agent instances
- `EnvironmentClient` - Fetch environments by reference

**Prevention**: Always resolve full chain, don't skip AgentInstance layer

**Reference**: `backend/services/agent-runner/docs/architecture/data-model.md`

### 2026-01-12 - ApiResourceReference vs IDs

**Problem**: Code tried to fetch skills by IDs - wrong reference type

**Root Cause**: Skills use ApiResourceReference, not string IDs

**ApiResourceReference Structure**:
```protobuf
message ApiResourceReference {
  ApiResourceOwnerScope scope = 1;  // platform/org/identity
  string org = 2;                    // org ID (required if scope=org)
  ApiResourceKind kind = 3;          // resource type enum
  string slug = 4;                   // human-readable name (NOT ID!)
}
```

**Solution**: Use references instead of IDs:
```python
# ❌ WRONG
skill_ids = ["skill-123", "skill-456"]
skills = await skill_client.list_by_ids(skill_ids)

# ✅ CORRECT
skill_refs = agent.spec.skill_refs  # repeated ApiResourceReference
skills = await skill_client.list_by_refs(skill_refs)
```

**Client Method**:
```python
async def list_by_refs(self, refs: list[ApiResourceReference]) -> list[Skill]:
    """Fetch skills by ApiResourceReference"""
    return await asyncio.gather(*[
        self.stub.getByReference(ref) for ref in refs
    ])
```

**Prevention**: Always use ApiResourceReference for resource lookups, not IDs

### 2026-01-12 - Environment Merging with Override Semantics

**Problem**: Multiple environments need to be layered with proper override behavior

**Solution**: Merge environments in order, later values override earlier:

```python
merged_env = {}

# 1. Start with agent base
if agent.spec.env_spec and agent.spec.env_spec.data:
    for key, env_value in agent.spec.env_spec.data.items():
        merged_env[key] = env_value.value

# 2. Layer each environment (order matters!)
for env in environments:
    if env.spec.data:
        for key, env_value in env.spec.data.items():
            merged_env[key] = env_value.value

# 3. Apply runtime overrides (highest priority)
if execution.spec.runtime_env:
    runtime_vars = {
        key: value.value 
        for key, value in execution.spec.runtime_env.items()
    }
    merged_env.update(runtime_vars)
```

**Merge Priority** (highest to lowest):
1. `execution.runtime_env` (highest)
2. `environment_refs[n]` (last environment)
3. `environment_refs[1]` (second environment)
4. `environment_refs[0]` (first environment)
5. `agent.env_spec` (base from template)

**Use Case**: Layer base → aws-prod → github-team environments with execution-scoped overrides

**Prevention**: Always preserve order when fetching environment_refs

---

## Documentation Organization

### 2026-01-12 - Service Documentation Standards

**Problem**: Documentation scattered in root with UPPERCASE names

**Root Cause**: No clear organization strategy

**Solution**: Follow monorepo documentation standards:

**Structure**:
```
backend/services/agent-runner/
├── README.md (concise with links)
├── Makefile
└── docs/
    ├── README.md (complete navigation index)
    ├── architecture/
    │   └── data-model.md
    ├── implementation/
    │   ├── type-checking.md
    │   └── agent-instance-migration.md
    └── guides/
        └── documentation-organization.md
```

**Naming Convention**: lowercase-with-hyphens
- ✅ `data-model.md`
- ✅ `type-checking.md`
- ❌ `DataModel.md`
- ❌ `TYPE_CHECKING.md`

**Categories**:
- `architecture/` - System design and patterns
- `implementation/` - What was built and how
- `guides/` - How-to instructions

**Prevention**: Always organize docs in `docs/` folder with proper categories and naming

**Reference**: `stigmer/.cursor/rules/documentation-standards.md`

---

## Temporal Polyglot Patterns

### 2026-01-12 - Polyglot Task Queue Architecture

**Problem**: Need to integrate Java workflows (stigmer-service) with Python activities (agent-runner) using Temporal

**Root Cause**: Uncertain how to safely share task queues between Java and Python workers

**Solution**: Java and Python CAN share the same task queue if done correctly:

**Java Worker (stigmer-service)**:
```java
@Bean
public Worker agentExecutionWorker(WorkerFactory factory) {
    Worker worker = factory.newWorker(taskQueue);
    
    // ONLY register workflows - NO activities!
    worker.registerWorkflowImplementationTypes(
        InvokeAgentExecutionWorkflowImpl.class
    );
    
    return worker;
}
```

**Python Worker (agent-runner)**:
```python
# worker.py
worker = Worker(
    client,
    task_queue=config.task_queue,  # Same queue as Java!
    activities=[
        execute_graphton,
        ensure_thread,
    ],
    # NO workflows registered
)
```

**Why This Works**:
- Temporal internally separates workflow tasks from activity tasks
- Java worker polls for workflow decisions only
- Python worker polls for activity executions only
- No collision because they process different task types

**CRITICAL Rule**: ❌ NEVER register activities on Java worker  
- Would make Java poll for activity tasks
- Temporal would load-balance activities between Java and Python
- Python activities routed to Java → "Activity not registered" error

**When to Use Separate Queues**:
If Java service needs Java-specific activities (e.g., database lookups), use a separate queue:
```java
@Bean
public Worker javaActivitiesWorker(WorkerFactory factory) {
    Worker worker = factory.newWorker("execution-java-activities");  // Different queue
    worker.registerActivitiesImplementations(/* Java activities */);
    return worker;
}
```

**Prevention**: Always separate workflows (Java) from activities (Python) when sharing queues

**Pattern Source**: Planton Cloud `agent-fleet` + `agent-fleet-worker`

**Reference**: `backend/services/stigmer-service/.../temporal/README.md`

### 2026-01-12 - Activity Signature Synchronization (Java ↔ Python)

**Problem**: Python activity must match Java interface signature exactly

**Root Cause**: Java workflow calls activities via interfaces, Python must implement matching signatures

**Solution**: Keep signatures synchronized:

**Java Activity Interface**:
```java
@ActivityInterface
public interface EnsureThreadActivity {
    @ActivityMethod(name = "EnsureThread")
    String ensureThread(String sessionId, String agentId) throws Exception;
}
```

**Python Activity Implementation**:
```python
@activity.defn(name="EnsureThread")  # Name must match!
async def ensure_thread(session_id: str, agent_id: str) -> str:  # Params must match!
    # Implementation
    return thread_id
```

**Critical Points**:
- `@ActivityMethod(name = "...")` must match `@activity.defn(name="...")`
- Parameter order must match exactly
- Parameter types must be compatible (String ↔ str)
- Return type must be compatible

**Common Mistake**:
```python
# ❌ WRONG - Missing parameter that Java interface has
@activity.defn(name="EnsureThread")
async def ensure_thread(session_id: str) -> str:  # Missing agent_id!
    pass
```

**Prevention**: 
1. Always check Java interface before implementing Python activity
2. Keep parameter lists synchronized during updates
3. Document signature contract in both places

### 2026-01-12 - Configurable Task Queues

**Problem**: Task queues were hardcoded, making environment-specific configuration impossible

**Root Cause**: Following Planton pattern where task queues are hardcoded as "execution"

**Solution**: Make task queues configurable via environment variables

**Java Service (stigmer-service)**:
```java
@Configuration
public class AgentExecutionTemporalWorkerConfig {
    @Value("${temporal.agent-execution.task-queue:execution}")
    private String taskQueue;
    
    @Bean
    public Worker agentExecutionWorker(WorkerFactory factory) {
        return factory.newWorker(taskQueue);  // Configurable!
    }
}
```

**Python Worker (agent-runner)**:
```python
# worker/config.py
@dataclass
class Config:
    task_queue: str
    
    @classmethod
    def load_from_env(cls):
        task_queue = os.getenv("TEMPORAL_AGENT_EXECUTION_TASK_QUEUE", "execution")
        return cls(task_queue=task_queue, ...)
```

**Kustomize Configuration**:
```yaml
env:
  variables:
    TEMPORAL_AGENT_EXECUTION_TASK_QUEUE:
      value: execution
```

**Benefits**:
- ✅ Environment-specific queues (dev/staging/prod)
- ✅ No code changes to adjust configuration
- ✅ Explicit about infrastructure setup
- ✅ Flexible deployment patterns

**Prevention**: Always configure infrastructure components via environment variables

### 2026-01-12 - Activity Task Queue Inheritance

**Problem**: Activities explicitly specifying task queues causes duplication and drift

**Solution**: Activities inherit task queue from workflow automatically

**Java Workflow**:
```java
// ❌ DON'T specify task queue in activity options
private final ExecuteGraphtonActivity activity = Workflow.newActivityStub(
    ExecuteGraphtonActivity.class,
    ActivityOptions.newBuilder()
        .setTaskQueue("execution")  // ❌ Explicit - can drift!
        .setStartToCloseTimeout(Duration.ofMinutes(10))
        .build()
);

// ✅ DO let activity inherit from workflow
private final ExecuteGraphtonActivity activity = Workflow.newActivityStub(
    ExecuteGraphtonActivity.class,
    ActivityOptions.newBuilder()
        // No task queue specified - inherits from workflow!
        .setStartToCloseTimeout(Duration.ofMinutes(10))
        .build()
);
```

**Why This Matters**:
- Activities automatically use workflow's task queue
- Reduces configuration duplication
- Ensures workflow and activities always coordinate
- Simpler code with less room for configuration drift

**Exception**: Only specify task queue if activity needs a DIFFERENT queue than workflow

**Prevention**: Let activities inherit task queue unless explicitly needed otherwise

### 2026-01-15 - Status Persistence via Stigmer-Service Activity (Polyglot Pattern)

**Problem**: Agent execution status fields (tool_calls[], sub_agent_executions[], todos) were not persisting to database despite Python worker building them correctly.

**Root Cause**: Two-layer problem discovered through systematic debugging:
1. **Python worker** (fixed in d63fefd): Only added to messages[], not tool_calls[]
2. **Java handler** (discovered in this session): Standard update pipeline **discarded status** from worker:
   - `clearStatusField` step: Removes status from incoming request
   - `buildNewState` step: Uses request (now with empty status)
   - `setAudit` step: Copies status from existing DB (also empty)
   - Result: Worker's status updates completely lost!

**Anti-Pattern Identified**: Initial fix attempt was to create custom RPC handler that accepts status.

**Issue**: Violates core design principle where:
- **Spec** = User inputs, updated via RPC ✅
- **Status** = System state, NOT via RPC ❌

**Correct Solution**: Polyglot Temporal activity for status persistence (user's architectural insight!)

**Implementation**: Create separate stigmer-service activity for persistence:

**Java Activity** (stigmer-service):
```java
@ActivityInterface
public interface UpdateExecutionStatusActivity {
    void updateExecutionStatus(String executionId, AgentExecutionStatus statusUpdates);
}

@Component
public class UpdateExecutionStatusActivityImpl implements UpdateExecutionStatusActivity {
    @Override
    public void updateExecutionStatus(String executionId, AgentExecutionStatus statusUpdates) {
        // 1. Load execution (SINGLE DB query - no multiple findById!)
        AgentExecution existing = executionRepo.findById(executionId).orElseThrow();
        
        // 2. Apply status updates
        AgentExecution.Builder builder = existing.toBuilder();
        builder.getStatusBuilder()
                .clearMessages().addAllMessages(statusUpdates.getMessagesList())
                .clearToolCalls().addAllToolCalls(statusUpdates.getToolCallsList())
                .clearSubAgentExecutions().addAllSubAgentExecutions(...)
                .putAllTodos(statusUpdates.getTodosMap())
                .setPhase(statusUpdates.getPhase());
        
        // 3. Persist atomically
        AgentExecution updated = builder.build();
        executionRepo.save(updated);              // MongoDB
        redisWriter.write(updated);                // Redis stream
        eventPublisher.publish(updated);           // NATS events
    }
}
```

**Python Helper Module** (agent-runner):
```python
# grpc_client/stigmer_service_activity_invoker.py
class StigmerServiceActivityInvoker:
    """Invokes stigmer-service persistence activities."""
    
    async def update_execution_status(self, execution_id: str, status_proto):
        await self.client.start_activity(
            "UpdateExecutionStatus",
            args=[execution_id, status_proto],
            task_queue="execution-persistence",  # Separate queue!
            start_to_close_timeout=timedelta(seconds=30),
        )
```

**Activity Registration** (stigmer-service):
```java
@Bean
public Worker executionPersistenceWorker(WorkerFactory factory) {
    Worker worker = factory.newWorker("execution-persistence");  // Separate queue!
    worker.registerActivitiesImplementations(updateExecutionStatusActivity);
    return worker;
}
```

**Task Queue Design**:
- `execution`: Agent execution activities (agent-runner)
- `execution-persistence`: Persistence activities (stigmer-service)
- Separate queues avoid collision

**Benefits**:
1. **Maintains Design**: RPC = spec, Activity = status
2. **Single DB Query**: Activity loads once (not multiple findById via RPC pipeline)
3. **Security**: Status not exposed via RPC
4. **Performance**: Batch updates, no RPC overhead
5. **Language-Agnostic**: Naming focuses on domain, not implementation

**Language-Agnostic Naming Convention** (user feedback):
- ✅ `stigmer_service_activity_invoker.py` (service name, not "java")
- ✅ `execution-persistence` queue (purpose, not "java-activities")
- ✅ `EXECUTION_PERSISTENCE_TASK_QUEUE` (domain, not language)
- ❌ `java_activity_invoker.py` (couples to language)
- ❌ `execution-java-activities` (implementation detail)

**Why**: If stigmer-service is rewritten in Go, names still make sense!

**Pattern**: Build status locally in Python, flush periodically via activity:
```python
# Initialize
updater = ExecutionStatusUpdater(temporal_client)
updater.initialize_for_execution(execution_id, initial_status)

# Process events locally (no network calls)
async for event in agent_graph.astream_events(...):
    await updater.process_event(event)  # Build locally
    
    if events % 10 == 0:
        await updater.flush()  # Batch flush to persistence

# Final flush
await updater.flush()
```

**Key Learning**: For worker-managed resources (like Execution), status comes from worker, not backend. Standard RPC pipeline assumes backend computes status (wrong for worker-managed resources). Use Temporal activity for internal status updates instead of RPC.

**Prevention**:
1. Use RPC only for user-facing spec updates
2. Use Temporal activities for system-managed status updates
3. Use language-agnostic names (service/domain, not language)
4. Keep persistence logic in stigmer-service (has DB access)
5. Batch status updates where possible (reduce activity calls)

**Reference**: 
- Java activity: `stigmer-service/.../activities/UpdateExecutionStatusActivity.java`
- Python invoker: `agent-runner/grpc_client/stigmer_service_activity_invoker.py`
- Documentation: `_docs/FINAL-SOLUTION-polyglot-temporal-status-updates.md`

### 2026-01-15 - Global Client Accessor Pattern for Activities

**Problem**: Activities need access to Temporal client for invoking other activities (e.g., status updater invoking persistence activity).

**Challenge**: Temporal activities can't easily receive complex dependencies. Worker initializes client, but activities run independently.

**Solution**: Global accessor pattern (similar to token_manager):

```python
# worker/temporal_client.py (NEW)
_temporal_client: Optional[Client] = None

def set_temporal_client(client: Client) -> None:
    """Set global Temporal client (called by worker)."""
    global _temporal_client
    _temporal_client = client

def get_temporal_client() -> Optional[Client]:
    """Get global Temporal client (used by activities)."""
    return _temporal_client
```

**Worker Setup** (worker.py):
```python
self.client = await Client.connect(...)
set_temporal_client(self.client)  # Make available to activities
```

**Usage in Activities**:
```python
# worker/activities/execute_graphton.py
temporal_client = get_temporal_client()
if not temporal_client:
    raise RuntimeError("Temporal client not initialized")

status_updater = ExecutionStatusUpdater(temporal_client)
```

**Benefits**:
- Simple to use from any activity
- Initialized once by worker
- No complex dependency injection needed
- Thread-safe (worker is single-threaded)
- Consistent with token_manager pattern

**Pattern Reusability**: Can apply to other shared resources (Redis client, config, etc.)

**Prevention**: Always use global accessors for worker-initialized resources needed by activities

### 2026-01-15 - Batch Update Pattern with Periodic Flush

**Problem**: High-frequency events (e.g., chat model streaming) cause too many activity calls, impacting performance and cost.

**Example**: Chat streaming generates 100+ events per second, each triggering status update activity = expensive!

**Solution**: Build status locally, flush periodically:

```python
events_processed = 0

async for event in agent_graph.astream_events(...):
    # Build status locally (no network call)
    await status_updater.process_event(event)
    events_processed += 1
    
    # Flush every 10 events (configurable)
    if events_processed % 10 == 0:
        await status_updater.flush()  # Single activity call

# Final flush (ensure nothing lost)
await status_updater.flush()
```

**Batch Size Selection**:
- Too small (N=1): Too many activity calls, expensive
- Too large (N=100): Updates not real-time enough
- Sweet spot (N=10): Balance between real-time and efficiency

**Benefits**:
- 10x reduction in activity calls (100 events → 10 flushes)
- Still reasonably real-time (updates visible within seconds)
- Lower cost (fewer Temporal activity executions)
- Better performance (less network overhead)
- Atomic batch updates (all-or-nothing)

**Adaptive Batching** (future optimization):
```python
# Flush immediately for critical events
if event_type == "on_tool_start" or status_change == "phase":
    await status_updater.flush()
else:
    # Batch other events
    ...
```

**Prevention**: Always batch high-frequency updates. Consider flush frequency vs real-time requirements.

**Reference**: See execute_graphton.py lines for implementation

### 2026-01-15 - RPC Removal After Temporal Activity Migration

**Problem**: After implementing Temporal activity for status updates, old RPC update code was still present in execution_client.py, creating confusion and potential for using wrong pattern.

**Anti-Pattern Present**: Two mechanisms for updating status (RPC and activity), risk of using anti-pattern

**Solution**: Complete code cleanup and deprecation:

**1. Remove Update Methods**:
```python
# execution_client.py - BEFORE (740 lines)
class ExecutionClient:
    async def get(...)            # Read
    async def update(...)          # ❌ Update via RPC
    async def update_phase(...)    # ❌ Update via RPC
    async def add_error_message(...)  # ❌ Update via RPC
    async def update_from_event(...)  # ❌ Update via RPC
    async def _handle_tool_start_event(...)  # 700+ lines of processing
    # ... many helper methods

# execution_client.py - AFTER (50 lines)
class ExecutionClient:
    async def get(...)            # ✅ Read only
    # Everything else removed!
```

**2. Deprecate with Clear Path**:
```python
async def update_from_event(...):
    """
    ⚠️ DEPRECATED: DO NOT USE
    
    USE INSTEAD: ExecutionStatusUpdater.process_event() + flush()
    """
    raise NotImplementedError(
        "update_from_event is deprecated. Use ExecutionStatusUpdater.\n"
        "See execute_graphton.py for example usage."
    )
```

**3. Document Migration**:
- Created `MIGRATION-SUMMARY.md` with before/after architecture
- Testing checklist for verification
- Rollback plan if needed

**Code Reduction**: 740 lines → 50 lines (93% reduction in execution_client.py)

**Benefits**:
- Single source of truth (only Temporal activity path)
- No confusion about which method to use
- Fails fast if old method accidentally called
- Clear migration guidance in error message
- Cleaner codebase, easier to maintain

**Pattern**: After architectural migration, aggressively remove old code paths and provide deprecation guidance.

**Prevention**:
1. After implementing new pattern, immediately remove old pattern
2. Use NotImplementedError with helpful message, not just comments
3. Create migration documentation
4. Update all call sites in same PR
5. Don't leave both paths coexisting

**Reference**: See `backend/services/agent-runner/MIGRATION-SUMMARY.md`

### 2026-01-15 - Module Simplification via Responsibility Transfer

**Problem**: execution_client.py had grown to 740 lines with complex event processing logic that belonged elsewhere.

**Original Responsibilities** (too many):
- gRPC communication ✅ (correct)
- Event processing ❌ (should be separate)
- Status building ❌ (should be separate)
- Tool call tracking ❌ (should be separate)
- Todo updates ❌ (should be separate)

**Solution**: Transfer responsibilities to specialized modules:

**Before**:
```
execution_client.py (740 lines)
  ├─ gRPC communication
  ├─ Event processing (700+ lines)
  ├─ Status building logic
  ├─ Tool call deduplication
  └─ Helper methods
```

**After**:
```
execution_client.py (50 lines) - gRPC read-only
execution_status_updater.py (340 lines) - Event processing + status building
stigmer_service_activity_invoker.py (110 lines) - Activity invocation
```

**Benefits**:
- Single Responsibility Principle restored
- Each module has clear purpose
- Easier to test in isolation
- Easier to understand and maintain
- Better code organization

**Pattern**: When module exceeds ~200 lines, evaluate if responsibilities can be split

**Prevention**: During code reviews, watch for modules accumulating responsibilities

### 2026-01-15 - Progressive Status Updates via gRPC (CORRECT PATTERN)

**Problem**: Agent execution status wasn't visible during execution. Temporal activity approach (`UpdateExecutionStatusActivity`) was attempted but activities can't call other activities.

**Root Cause - Temporal Limitation**: **Activities CANNOT call other activities** (core Temporal design constraint).

The attempted pattern was:
```python
# ❌ WRONG - Activities can't call activities!
@activity.defn(name="ExecuteGraphton")
async def execute_graphton(...):
    status = build_status()
    await temporal_client.start_activity("UpdateExecutionStatus", ...)  # Fails!
```

**Error**: `'Client' object has no attribute 'start_activity'` - because Temporal doesn't support this pattern.

**Correct Solution**: Use **gRPC calls** for progressive status updates during execution:

```python
from grpc_client.agent_execution_client import AgentExecutionClient

@activity.defn(name="ExecuteGraphton")
async def execute_graphton(execution: AgentExecution, thread_id: str) -> AgentExecutionStatus:
    # Initialize gRPC client for status updates
    execution_client = AgentExecutionClient(token_manager)
    
    # Execute agent and send progressive updates
    events_processed = 0
    update_interval = 10  # Configurable
    
    async for event in agent_graph.astream_events(...):
        await status_builder.process_event(event)
        events_processed += 1
        
        # Send status update via gRPC (every N events)
        if events_processed % update_interval == 0:
            try:
                await execution_client.update(
                    execution_id=execution_id,
                    status=status_builder.current_status
                )
            except Exception as e:
                # Log but don't fail - keep processing
                activity_logger.warning(f"Status update failed: {e}")
    
    # Send final status update
    await execution_client.update(execution_id, status_builder.current_status)
    
    # Return final status to workflow (for observability)
    return status_builder.current_status
```

**gRPC Client** (`grpc_client/agent_execution_client.py`):
```python
class AgentExecutionClient:
    """Client for sending status updates to AgentExecutionCommandController."""
    
    async def update_status(self, execution_id: str, status: AgentExecutionStatus):
        execution_update = AgentExecution(
            api_version="agentic.stigmer.ai/v1",
            kind="AgentExecution",
            metadata=ApiResourceMetadata(id=execution_id),
            status=status
        )
        return await self.command_stub.updateStatus(execution_update)
```

**Java Handler** (stigmer-service - custom build step required):
```java
// Standard buildNewState clears status (spec-only updates)
// Need custom step that MERGES status updates

@Component
static class BuildNewStateWithStatusStep implements RequestPipelineStepV2<UpdateContextV2<AgentExecution>> {
    
    @Override
    public RequestPipelineStepResultV2 execute(UpdateContextV2<AgentExecution> context) {
        AgentExecution request = context.getRequest();
        AgentExecution existing = context.getExistingState();
        
        AgentExecution.Builder builder = existing.toBuilder();
        
        // MERGE status from request (not clear)
        if (request.hasStatus()) {
            var statusBuilder = builder.getStatusBuilder();
            
            // Replace messages with latest
            if (requestStatus.getMessagesCount() > 0) {
                statusBuilder.clearMessages()
                        .addAllMessages(requestStatus.getMessagesList());
            }
            
            // Replace tool_calls, todos, phase...
        }
        
        context.setNewState(builder.build());
        return RequestPipelineStepResultV2.success(getName());
    }
}
```

**Benefits**:
1. ✅ **Real-time updates**: Users see progress every N events (not batch at end)
2. ✅ **Simple pattern**: Direct gRPC calls (no complex Temporal child workflows)
3. ✅ **Low overhead**: ~300-500ms total for typical execution (<1%)
4. ✅ **Fault tolerant**: Execution continues even if updates fail
5. ✅ **Scalable**: No separate persistence queue needed

**Configuration**:
```python
# Tune update frequency:
update_interval = 10  # Options: 5 (more real-time), 10 (balanced), 20 (less overhead)
```

**Key Architectural Insight**:
- **Temporal**: Use for orchestration (EnsureThread → ExecuteGraphton flow)
- **gRPC**: Use for direct communication (progressive status updates)
- **Combine both**: Best of both worlds

**Why gRPC Over Temporal Activities**:
- Activities can't call activities (Temporal limitation)
- Child workflows add significant overhead
- Heartbeats not designed for data transfer
- Direct gRPC is simple and efficient

**Why Not Temporal Workflows for Each Update**:
- Starting workflow for each update = high overhead
- Could create thousands of workflow instances
- Temporal UI would be cluttered
- gRPC updates are faster and simpler

**Trade-Offs**:
| Aspect | gRPC Updates | Temporal Activities |
|--------|--------------|---------------------|
| Real-time | ✅ Yes | ✅ Yes (with child workflows) |
| Simplicity | ✅ Simple | ❌ Complex |
| Overhead | ✅ Low | ❌ High |
| Observability | ⚠️ Logs only | ✅ Temporal UI |
| Retry logic | ❌ Manual | ✅ Automatic |

**Chosen approach**: gRPC (simplicity + low overhead wins for this use case)

**Prevention**:
1. Don't try to call activities from activities (won't work)
2. Use gRPC for direct service-to-service communication
3. Use Temporal for orchestration, not data transfer
4. Create custom pipeline steps when standard behavior doesn't fit
5. Make status updates best-effort (don't break execution)

**Related Docs**: 
- Architecture: `backend/services/agent-runner/docs/architecture/agent-execution-workflow.md`
- Guide: `backend/services/agent-runner/docs/guides/working-with-agent-execution.md`
- Implementation: `backend/services/agent-runner/docs/fixes/2026-01-15-implement-progressive-status-updates-via-grpc.md`

**Historical Note**: The "Status Persistence via Stigmer-Service Activity" entry above (line 1162) documents an approach that was attempted but superseded by this gRPC pattern. Keeping both for historical context - shows the evolution from "tried Temporal activities" → "learned limitation" → "pivoted to gRPC".

---

## Future Topics

As the service evolves, add sections for:
- MCP Resolution
- Sub-agent Delegation
- Performance Optimization
- Monitoring & Observability
- Testing Patterns

---

## Meta: Using This Log

**Good Example**:
- Search for error message: "No module named 'ai.stigmer'"
- Find section: "Proto Imports & Stubs"
- Apply documented solution

**Bad Example**:
- Don't search log
- Spend 30 minutes debugging
- Solve problem that was already documented
- Waste time reinventing solution

**Remember**: This log saves time. Check it first!

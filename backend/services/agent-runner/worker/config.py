"""Configuration management for agent-runner.

Polyglot Workflow Configuration:
================================
This Python worker runs activities for Java-orchestrated Temporal workflows.

Task Queue: "agent_execution_runner" (agent-runner owns Python activities)
- Configured via: TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE
- Default: "agent_execution_runner"
- Java workflows run on separate queue: "agent_execution_stigmer"

Python Worker (this) Registers:
- ExecuteGraphton activity
- EnsureThread activity
- CleanupSandbox activity

Java Worker (stigmer-service) Registers:
- InvokeAgentExecutionWorkflow (orchestration on agent_execution_stigmer)
- UpdateExecutionStatusActivity (error recovery)

How Polyglot Works:
- Python worker polls "agent_execution_runner" for activity tasks
- Java worker polls "agent_execution_stigmer" for workflow tasks
- Java workflows call activities with explicit task queue routing
- Temporal routes activity tasks to Python based on task queue
"""

import logging
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from worker.storage import ArtifactStorageConfig

logger = logging.getLogger(__name__)


class ExecutionMode(Enum):
    """Execution mode for agent commands.
    
    LOCAL: Execute directly on host machine (default, fast)
    SANDBOX: Execute in isolated Docker container (isolated)
    AUTO: Automatically detect based on command (smart)
    """
    LOCAL = "local"
    SANDBOX = "sandbox"
    AUTO = "auto"


@dataclass
class LLMConfig:
    """LLM configuration for agent execution.
    
    Supports multiple providers (Anthropic, Ollama, OpenAI) with provider-specific settings.
    Configuration cascade: explicit config > env vars > mode-aware defaults.
    
    Local Mode Default:
        - Provider: ollama
        - Model: qwen2.5-coder:7b
        - Base URL: http://localhost:11434
        - Zero config, zero dependencies
    
    Cloud Mode Default:
        - Provider: anthropic
        - Model: claude-sonnet-4.5
        - Requires API key
    """
    
    # Core configuration
    provider: str  # "anthropic" | "ollama" | "openai"
    model_name: str
    
    # Provider-specific settings
    base_url: str | None = None  # Required for Ollama
    api_key: str | None = None  # Required for Anthropic/OpenAI
    
    # Model parameters (optional)
    max_tokens: int | None = None
    temperature: float | None = None
    
    @classmethod
    def load_from_env(
        cls, mode: str, *, proxy_active: bool = False,
    ) -> "LLMConfig":
        """Load LLM configuration from environment variables.
        
        Args:
            mode: Execution mode ("local" or "cloud") for default selection.
            proxy_active: When True, LLM calls will route through the
                Side-Channel Proxy and provider API keys are not required
                on the runner (the proxy injects them server-side).
            
        Returns:
            LLMConfig instance with cascaded configuration
            
        Environment Variables:
            STIGMER_LLM_PROVIDER: LLM provider (anthropic|ollama|openai)
            STIGMER_LLM_MODEL: Model name (provider-specific)
            OLLAMA_BASE_URL: Base URL for Ollama (standard LangChain variable)
            STIGMER_LLM_API_KEY: API key for Anthropic/OpenAI (not required
                when proxy is active)
            STIGMER_LLM_MAX_TOKENS: Override default max_tokens
            STIGMER_LLM_TEMPERATURE: Override default temperature
            
        Configuration Cascade:
            1. Environment variables (explicit user config)
            2. Mode-aware defaults:
               - local mode: Ollama with qwen2.5-coder:7b
               - cloud mode: Anthropic with claude-sonnet-4.5
        """
        # Determine mode-aware defaults
        if mode == "local":
            default_provider = "ollama"
            default_model_name = "qwen2.5-coder:7b"
            default_base_url: str | None = "http://localhost:11434"
            default_max_tokens: int | None = 8192
            default_temperature: float | None = 0.0
        else:  # cloud mode
            default_provider = "anthropic"
            default_model_name = "claude-sonnet-4.5"
            default_base_url = None
            default_max_tokens = 20000
            default_temperature = None
        
        # Read from environment (overrides defaults)
        provider = os.getenv("STIGMER_LLM_PROVIDER", default_provider)
        model_name = os.getenv("STIGMER_LLM_MODEL", default_model_name)
        
        # Provider-specific settings
        # STIGMER_LLM_BASE_URL is the canonical name set by kustomize; fall back
        # to OLLAMA_BASE_URL for backward compatibility with local/Ollama setups.
        base_url = (
            os.getenv("STIGMER_LLM_BASE_URL")
            or os.getenv("OLLAMA_BASE_URL", default_base_url)
        )
        
        # API key with backward compatibility
        api_key = (
            os.getenv("STIGMER_LLM_API_KEY") or 
            os.getenv("ANTHROPIC_API_KEY")
        )
        
        # Optional overrides
        max_tokens_str = os.getenv("STIGMER_LLM_MAX_TOKENS")
        max_tokens = int(max_tokens_str) if max_tokens_str else default_max_tokens
        
        temperature_str = os.getenv("STIGMER_LLM_TEMPERATURE")
        temperature = float(temperature_str) if temperature_str else default_temperature
        
        # Create config
        config = cls(
            provider=provider,
            model_name=model_name,
            base_url=base_url,
            api_key=api_key,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        
        config.validate(proxy_active=proxy_active)
        
        return config
    
    def validate(self, *, proxy_active: bool = False) -> None:
        """Validate configuration is complete and correct.
        
        Args:
            proxy_active: When True, provider API keys are not required
                because the Side-Channel Proxy injects them server-side.
        
        Raises:
            ValueError: If configuration is invalid
        """
        # Validate provider
        valid_providers = {"anthropic", "ollama", "openai"}
        if self.provider not in valid_providers:
            raise ValueError(
                f"Invalid provider '{self.provider}'. "
                f"Must be one of: {', '.join(valid_providers)}"
            )
        
        # Validate provider-specific requirements
        if self.provider == "ollama":
            if not self.base_url:
                raise ValueError(
                    "base_url is required for Ollama provider. "
                    "Set OLLAMA_BASE_URL environment variable (default: http://localhost:11434)"
                )
        
        if self.provider in {"anthropic", "openai"}:
            if not self.api_key and not proxy_active:
                raise ValueError(
                    f"api_key is required for {self.provider} provider "
                    f"when proxy is not active. Set STIGMER_LLM_API_KEY, "
                    f"ANTHROPIC_API_KEY, or STIGMER_PROXY_ENDPOINT."
                )
        
        # Validate model name is not empty
        if not self.model_name or not self.model_name.strip():
            raise ValueError("model_name cannot be empty")
    
    def build_llm_kwargs(
        self,
        proxy_endpoint: str | None = None,
        proxy_auth_token: str | None = None,
    ) -> dict[str, Any]:
        """Build provider-appropriate kwargs for ``parse_model_string``.
        
        When *proxy_endpoint* is set, routes LLM calls through the
        Side-Channel Proxy.  The proxy is transparent to the LangChain SDK:
        it receives standard API requests and forwards them to the real
        provider after substituting the API key server-side.
        
        The returned dict is intended to be spread into ``parse_model_string``
        via ``**kwargs`` — it contains only the keys relevant to the current
        provider and deployment mode (direct vs proxy).
        
        Args:
            proxy_endpoint: Side-channel proxy base URL
                (e.g. ``https://proxy.stigmer.ai``).  When set, ``base_url``
                and ``api_key`` are resolved for the proxy.
            proxy_auth_token: Auth token for the proxy
                (typically ``STIGMER_API_KEY``).
        
        Returns:
            Dict of kwargs to pass to ``parse_model_string``.
        """
        if proxy_endpoint and self.provider in ("anthropic", "openai"):
            # The OpenAI SDK includes ``/v1`` in its base_url
            # (default ``https://api.openai.com/v1``), while the Anthropic
            # SDK does not (default ``https://api.anthropic.com``).
            if self.provider == "openai":
                proxy_base = f"{proxy_endpoint}/v1/proxy/llm/openai/v1"
            else:
                proxy_base = f"{proxy_endpoint}/v1/proxy/llm/anthropic"
            
            return {
                "base_url": proxy_base,
                "api_key": proxy_auth_token,
            }
        
        if self.provider == "ollama":
            return {"base_url": self.base_url}
        
        if self.provider in ("anthropic", "openai"):
            return {"api_key": self.api_key}
        
        return {}


@dataclass
class CheckpointerConfig:
    """Checkpointer configuration for LangGraph state persistence.
    
    Enables two critical capabilities:
    1. HITL (Human-in-the-Loop) approval flow - interrupt/resume execution
    2. Conversational context preservation - multi-turn conversations
    
    Checkpointer Types:
    ------------------
    - memory: In-memory storage (ephemeral, fast, zero setup)
      Best for: Local development, testing, stateless workloads
      
    - sqlite: File-based storage (persistent, single-instance)
      Best for: Open source deployments, local persistence
      
    - mongodb: Database storage (persistent, multi-instance safe)
      Best for: Cloud deployments, horizontal scaling
    
    Configuration Cascade:
    1. Environment variables (explicit user config)
    2. Mode-aware defaults:
       - local mode: memory (zero config)
       - cloud mode: mongodb (shared state)
    """
    
    # Core configuration
    type: str  # "memory" | "sqlite" | "mongodb" | "http"
    
    # SQLite settings (local/open-source mode)
    sqlite_path: str | None = None
    
    # MongoDB settings (cloud mode, direct connection — legacy)
    mongodb_uri: str | None = None
    mongodb_db_name: str = "stigmer_checkpoints"
    mongodb_ttl_seconds: int | None = None  # Optional TTL for auto-cleanup
    
    # HTTP proxy settings (cloud mode via Side-Channel Proxy)
    proxy_endpoint: str | None = None
    auth_token: str | None = None
    
    @classmethod
    def load_from_env(cls, mode: str) -> "CheckpointerConfig":
        """Load checkpointer configuration from environment variables.
        
        Args:
            mode: Execution mode ("local" or "cloud") for default selection
            
        Returns:
            CheckpointerConfig instance with cascaded configuration
            
        Environment Variables:
            STIGMER_CHECKPOINTER_TYPE: Checkpointer type
                (memory|sqlite|mongodb|http)
            STIGMER_CHECKPOINTER_SQLITE_PATH: Path for SQLite database file
            STIGMER_CHECKPOINTER_MONGODB_URI: MongoDB connection string
            STIGMER_CHECKPOINTER_MONGODB_DB: MongoDB database name
            STIGMER_CHECKPOINTER_TTL: TTL in seconds for checkpoint expiration
            STIGMER_PROXY_ENDPOINT: Proxy base URL (required for http type)
            STIGMER_API_KEY: Proxy auth token (required for http type)
            
        Configuration Cascade:
            1. Environment variables (explicit user config)
            2. Mode-aware defaults:
               - local mode: sqlite (persistent, HITL-compatible)
               - cloud mode: mongodb (persistent, shared)
        """
        # Determine mode-aware defaults
        if mode == "local":
            # SQLite is the default for local mode because:
            # 1. Persistent across activity re-invocations (required for HITL approval)
            # 2. Zero setup - single file, no external dependencies
            # 3. MemorySaver is incompatible with HITL because each Temporal activity
            #    invocation creates a new MemorySaver instance, losing all checkpoints
            default_type = "sqlite"
            default_sqlite_path: str | None = "./checkpoints/langgraph.db"
        else:  # cloud mode
            default_type = "mongodb"
            default_sqlite_path = None
        
        # Read from environment (overrides defaults)
        checkpointer_type = os.getenv("STIGMER_CHECKPOINTER_TYPE", default_type)
        
        # SQLite settings
        sqlite_path = os.getenv("STIGMER_CHECKPOINTER_SQLITE_PATH", default_sqlite_path)
        
        # MongoDB settings
        mongodb_uri = os.getenv("STIGMER_CHECKPOINTER_MONGODB_URI")
        mongodb_db_name = os.getenv("STIGMER_CHECKPOINTER_MONGODB_DB", "stigmer_checkpoints")
        
        # TTL for checkpoint expiration (optional)
        ttl_str = os.getenv("STIGMER_CHECKPOINTER_TTL")
        mongodb_ttl_seconds = int(ttl_str) if ttl_str else None
        
        # HTTP proxy settings (only relevant for http checkpointer type)
        proxy_endpoint = (
            os.getenv("STIGMER_PROXY_ENDPOINT")
            if checkpointer_type == "http" else None
        )
        auth_token = (
            os.getenv("STIGMER_API_KEY")
            if checkpointer_type == "http" else None
        )
        
        # Create config
        config = cls(
            type=checkpointer_type,
            sqlite_path=sqlite_path,
            mongodb_uri=mongodb_uri,
            mongodb_db_name=mongodb_db_name,
            mongodb_ttl_seconds=mongodb_ttl_seconds,
            proxy_endpoint=proxy_endpoint,
            auth_token=auth_token,
        )
        
        # Validate before returning
        config.validate(mode)
        
        return config
    
    def validate(self, mode: str = "cloud") -> None:
        """Validate configuration is complete and correct.
        
        Args:
            mode: Execution mode for context-aware validation
            
        Raises:
            ValueError: If configuration is invalid
        """
        # Validate type
        valid_types = {"memory", "sqlite", "mongodb", "http"}
        if self.type not in valid_types:
            raise ValueError(
                f"Invalid checkpointer type '{self.type}'. "
                f"Must be one of: {', '.join(sorted(valid_types))}"
            )
        
        # Validate type-specific requirements
        if self.type == "sqlite":
            if not self.sqlite_path:
                raise ValueError(
                    "sqlite_path is required for sqlite checkpointer. "
                    "Set STIGMER_CHECKPOINTER_SQLITE_PATH environment variable."
                )
        
        if self.type == "mongodb":
            if not self.mongodb_uri:
                raise ValueError(
                    "mongodb_uri is required for mongodb checkpointer. "
                    "Set STIGMER_CHECKPOINTER_MONGODB_URI environment variable."
                )
            
            # Validate MongoDB database name is not empty
            if not self.mongodb_db_name or not self.mongodb_db_name.strip():
                raise ValueError(
                    "mongodb_db_name cannot be empty. "
                    "Set STIGMER_CHECKPOINTER_MONGODB_DB or use default 'stigmer_checkpoints'."
                )
        
        if self.type == "http":
            if not self.proxy_endpoint:
                raise ValueError(
                    "proxy_endpoint is required for http checkpointer. "
                    "Set STIGMER_PROXY_ENDPOINT environment variable."
                )
            if not self.auth_token:
                raise ValueError(
                    "auth_token is required for http checkpointer. "
                    "Set STIGMER_API_KEY environment variable."
                )
        
        # Validate TTL if provided
        if self.mongodb_ttl_seconds is not None and self.mongodb_ttl_seconds < 0:
            raise ValueError(
                f"mongodb_ttl_seconds must be non-negative, got {self.mongodb_ttl_seconds}"
            )


@dataclass
class Config:
    """Worker configuration loaded from environment variables.
    
    Local Mode (MODE=local):
    ------------------------
    When MODE=local, the runner operates in local execution mode:
    - Uses filesystem backend instead of Daytona
    - Skips cloud dependencies (Redis, Auth0, etc.)
    - Connects to Stigmer Daemon (localhost:50051) for state/streaming
    - API key validation is relaxed (accepts dummy values)
    
    Cloud Mode (MODE=cloud or unset):
    ---------------------------------
    Standard cloud infrastructure mode:
    - Uses Daytona for sandboxed execution
    - Requires Redis for pub/sub
    - Full Auth0 validation
    - Connects to cloud Stigmer backend
    
    Note: 'MODE' is separate from 'ENV' (development/staging/production).
    - MODE determines execution infrastructure (local filesystem vs cloud sandbox)
    - ENV determines deployment environment (dev/staging/prod)
    """
    
    # Execution mode
    mode: str  # "local" or "cloud"
    
    # Core Temporal configuration (required for both modes)
    temporal_namespace: str
    temporal_service_address: str
    task_queue: str
    max_concurrency: int
    
    # Stigmer backend configuration (required for both modes)
    stigmer_backend_endpoint: str
    stigmer_api_key: str
    
    # Side-channel proxy endpoint (HTTP, e.g. https://proxy.stigmer.ai)
    # Used for LLM provider passthrough, checkpoint persistence, artifact storage.
    # In local mode this is unused — the runner talks to providers directly.
    stigmer_proxy_endpoint: str | None
    
    # Sandbox configuration (mode-specific)
    sandbox_type: str  # "filesystem" for local, "daytona" for cloud
    sandbox_root_dir: str | None  # Required for filesystem backend
    
    # LLM configuration
    llm: LLMConfig
    
    # Checkpointer configuration (for HITL and conversation persistence)
    checkpointer: CheckpointerConfig
    
    # Execution mode configuration (local/sandbox/auto)
    execution_mode: ExecutionMode
    sandbox_image: str  # Docker image for sandbox mode
    sandbox_auto_pull: bool  # Auto-pull image if missing
    sandbox_cleanup: bool  # Cleanup containers after execution
    sandbox_ttl: int  # Container reuse TTL in seconds
    
    # Artifact storage configuration (for attachments and outputs)
    artifact_storage: "ArtifactStorageConfig"

    @classmethod
    def load_from_env(cls):
        """Load configuration from environment variables."""
        # Detect execution mode (local vs cloud)
        mode = os.getenv("MODE", "cloud")
        is_local = mode == "local"
        
        # Detect proxy mode: when STIGMER_PROXY_ENDPOINT is set, LLM calls
        # route through the Side-Channel Proxy and provider API keys are
        # injected server-side (not required on the runner).
        proxy_endpoint = os.getenv("STIGMER_PROXY_ENDPOINT")
        proxy_active = bool(proxy_endpoint and proxy_endpoint.strip())
        
        # Load LLM configuration (mode-aware)
        llm_config = LLMConfig.load_from_env(mode, proxy_active=proxy_active)
        
        # Load checkpointer configuration (mode-aware)
        checkpointer_config = CheckpointerConfig.load_from_env(mode)
        
        # Load artifact storage configuration (mode-aware)
        from worker.storage import ArtifactStorageConfig
        artifact_storage_config = ArtifactStorageConfig.load_from_env(mode)
        
        # Load execution mode configuration
        execution_mode_str = os.getenv("STIGMER_EXECUTION_MODE", "local")
        try:
            execution_mode = ExecutionMode(execution_mode_str)
        except ValueError:
            raise ValueError(
                f"Invalid STIGMER_EXECUTION_MODE: {execution_mode_str}. "
                f"Must be one of: local, sandbox, auto"
            )
        
        # Sandbox configuration
        sandbox_image = os.getenv(
            "STIGMER_SANDBOX_IMAGE",
            "ghcr.io/stigmer/agent-sandbox-basic:latest"
        )
        sandbox_auto_pull = os.getenv("STIGMER_SANDBOX_AUTO_PULL", "true").lower() == "true"
        sandbox_cleanup = os.getenv("STIGMER_SANDBOX_CLEANUP", "true").lower() == "true"
        sandbox_ttl = int(os.getenv("STIGMER_SANDBOX_TTL", "3600"))  # 1 hour default
        
        # Load Stigmer API configuration
        stigmer_api_key = os.getenv("STIGMER_API_KEY", "")
        
        # In local mode, allow dummy API key for development
        if not stigmer_api_key and not is_local:
            raise ValueError("Missing required environment variable: STIGMER_API_KEY")
        
        # Use dummy key if missing in local mode
        if is_local and not stigmer_api_key:
            stigmer_api_key = "dummy-local-key"
        
        # Load sandbox configuration based on mode
        if is_local:
            sandbox_type = os.getenv("SANDBOX_TYPE", "filesystem")
            sandbox_root_dir = os.getenv("SANDBOX_ROOT_DIR", "./workspace")
            
        else:
            sandbox_type = "daytona"
            sandbox_root_dir = None
        
        # Load Temporal task queue for Python activities
        # Environment: TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE
        # Default: "agent_execution_runner"
        task_queue = os.getenv("TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE", "agent_execution_runner")
        
        # Default backend endpoint based on mode
        default_endpoint = "localhost:50051" if is_local else "localhost:8080"
        
        return cls(
            mode=mode,
            temporal_namespace=os.getenv("TEMPORAL_NAMESPACE", "default"),
            temporal_service_address=os.getenv("TEMPORAL_SERVICE_ADDRESS", "localhost:7233"),
            task_queue=task_queue,
            max_concurrency=int(os.getenv("TEMPORAL_MAX_CONCURRENCY", "10")),
            stigmer_backend_endpoint=os.getenv("STIGMER_BACKEND_ENDPOINT", default_endpoint),
            stigmer_api_key=stigmer_api_key,
            stigmer_proxy_endpoint=proxy_endpoint,
            sandbox_type=sandbox_type,
            sandbox_root_dir=sandbox_root_dir,
            llm=llm_config,
            checkpointer=checkpointer_config,
            execution_mode=execution_mode,
            sandbox_image=sandbox_image,
            sandbox_auto_pull=sandbox_auto_pull,
            sandbox_cleanup=sandbox_cleanup,
            sandbox_ttl=sandbox_ttl,
            artifact_storage=artifact_storage_config,
        )
    
    def get_sandbox_config(self, session_id: str | None = None) -> dict:
        """Get sandbox configuration based on execution mode.
        
        Args:
            session_id: Optional session identifier. When provided in local
                mode, the workspace root is scoped to a per-session directory
                (``{SANDBOX_ROOT_DIR}/sessions/{session_id}/``), ensuring each
                session has an isolated, persistent workspace.  When *None*,
                the flat ``SANDBOX_ROOT_DIR`` is used (backward-compatible).
                Ignored in cloud mode (session isolation is handled by
                Daytona volumes).
        
        Returns:
            Sandbox configuration dict for Graphton agent creation.
            
            Local mode:
                {"type": "filesystem", "root_dir": "<session-scoped path>"}
            
            Cloud mode:
                {"type": "daytona", "snapshot_id": "..."}  # snapshot_id optional
        
        Raises:
            ValueError: If *session_id* contains path separators or ``..``.
        """
        if session_id and ("/" in session_id or "\\" in session_id or ".." in session_id):
            raise ValueError(
                f"Invalid session_id '{session_id}': "
                "must not contain path separators or '..'"
            )
        
        if self.mode == "local":
            if self.sandbox_root_dir is None:
                raise RuntimeError(
                    "sandbox_root_dir must be configured in local mode"
                )
            root_dir = self.sandbox_root_dir
            if session_id:
                root_dir = str(Path(self.sandbox_root_dir) / "sessions" / session_id)
            return {
                "type": "filesystem",
                "root_dir": root_dir,
            }
        else:
            # Cloud mode - Daytona configuration
            config: dict[str, str] = {"type": "daytona"}

            # Snapshot resolution priority:
            # 1. SnapshotResolver (discovers latest custom stigmer-mcp-* snapshot)
            # 2. DAYTONA_DEV_TOOLS_SNAPSHOT_ID env var (fallback for bootstrapping)
            # 3. None (vanilla sandbox, no snapshot)
            snapshot_id = None

            from worker.snapshot_resolver import get_snapshot_resolver

            resolver = get_snapshot_resolver()
            if resolver:
                snapshot_id = resolver.resolve()

            if not snapshot_id:
                snapshot_id = os.getenv("DAYTONA_DEV_TOOLS_SNAPSHOT_ID")
                if snapshot_id:
                    logger.info(
                        "No custom snapshot found; using fallback "
                        "DAYTONA_DEV_TOOLS_SNAPSHOT_ID='%s'",
                        snapshot_id,
                    )

            if snapshot_id:
                config["snapshot_id"] = snapshot_id

            return config
    
    def is_local_mode(self) -> bool:
        """Check if running in local execution mode."""
        return self.mode == "local"

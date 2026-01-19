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

from dataclasses import dataclass
from typing import Optional
import os


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
    base_url: Optional[str] = None  # Required for Ollama
    api_key: Optional[str] = None  # Required for Anthropic/OpenAI
    
    # Model parameters (optional)
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    
    @classmethod
    def load_from_env(cls, mode: str) -> "LLMConfig":
        """Load LLM configuration from environment variables.
        
        Args:
            mode: Execution mode ("local" or "cloud") for default selection
            
        Returns:
            LLMConfig instance with cascaded configuration
            
        Environment Variables:
            STIGMER_LLM_PROVIDER: LLM provider (anthropic|ollama|openai)
            STIGMER_LLM_MODEL: Model name (provider-specific)
            STIGMER_LLM_BASE_URL: Base URL for Ollama (http://localhost:11434)
            STIGMER_LLM_API_KEY: API key for Anthropic/OpenAI
            STIGMER_LLM_MAX_TOKENS: Override default max_tokens
            STIGMER_LLM_TEMPERATURE: Override default temperature
            
        Configuration Cascade:
            1. Environment variables (explicit user config)
            2. Mode-aware defaults:
               - dev mode: Ollama with qwen2.5-coder:7b
               - cloud mode: Anthropic with claude-sonnet-4.5
        """
        # Determine mode-aware defaults
        if mode == "dev":
            defaults = {
                "provider": "ollama",
                "model_name": "qwen2.5-coder:7b",
                "base_url": "http://localhost:11434",
                "max_tokens": 8192,
                "temperature": 0.0,
            }
        else:  # cloud mode
            defaults = {
                "provider": "anthropic",
                "model_name": "claude-sonnet-4.5",
                "max_tokens": 20000,
                "temperature": None,
            }
        
        # Read from environment (overrides defaults)
        provider = os.getenv("STIGMER_LLM_PROVIDER", defaults["provider"])
        model_name = os.getenv("STIGMER_LLM_MODEL", defaults["model_name"])
        
        # Provider-specific settings
        base_url = os.getenv("STIGMER_LLM_BASE_URL", defaults.get("base_url"))
        
        # API key with backward compatibility
        api_key = (
            os.getenv("STIGMER_LLM_API_KEY") or 
            os.getenv("ANTHROPIC_API_KEY")
        )
        
        # Optional overrides
        max_tokens_str = os.getenv("STIGMER_LLM_MAX_TOKENS")
        max_tokens = int(max_tokens_str) if max_tokens_str else defaults.get("max_tokens")
        
        temperature_str = os.getenv("STIGMER_LLM_TEMPERATURE")
        temperature = float(temperature_str) if temperature_str else defaults.get("temperature")
        
        # Create config
        config = cls(
            provider=provider,
            model_name=model_name,
            base_url=base_url,
            api_key=api_key,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        
        # Validate before returning
        config.validate()
        
        return config
    
    def validate(self) -> None:
        """Validate configuration is complete and correct.
        
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
                    "Set STIGMER_LLM_BASE_URL (default: http://localhost:11434)"
                )
        
        if self.provider in {"anthropic", "openai"}:
            if not self.api_key:
                raise ValueError(
                    f"api_key is required for {self.provider} provider. "
                    f"Set STIGMER_LLM_API_KEY or ANTHROPIC_API_KEY"
                )
        
        # Validate model name is not empty
        if not self.model_name or not self.model_name.strip():
            raise ValueError("model_name cannot be empty")


@dataclass
class Config:
    """Worker configuration loaded from environment variables.
    
    Dev Mode (MODE=dev):
    --------------------
    When MODE=dev, the runner operates in development mode:
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
    
    # Sandbox configuration (mode-specific)
    sandbox_type: str  # "filesystem" for local, "daytona" for cloud
    sandbox_root_dir: str | None  # Required for filesystem backend
    
    # Redis configuration (cloud mode only)
    redis_host: str | None
    redis_port: int | None
    redis_password: str | None
    
    # LLM configuration
    llm: LLMConfig

    @classmethod
    def load_from_env(cls):
        """Load configuration from environment variables."""
        # Detect execution mode (local vs cloud)
        mode = os.getenv("MODE", "cloud")
        is_dev = mode == "dev"
        
        # Load LLM configuration (mode-aware)
        llm_config = LLMConfig.load_from_env(mode)
        
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
            
            # Redis not required in local mode
            redis_host = None
            redis_port = None
            redis_password = None
        else:
            sandbox_type = "daytona"
            sandbox_root_dir = None
            
            # Redis required in cloud mode
            redis_host = os.getenv("REDIS_HOST", "localhost")
            redis_port = int(os.getenv("REDIS_PORT", "6379"))
            redis_password = os.getenv("REDIS_PASSWORD")  # Optional
        
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
            sandbox_type=sandbox_type,
            sandbox_root_dir=sandbox_root_dir,
            redis_host=redis_host,
            redis_port=redis_port,
            redis_password=redis_password if redis_password else None,
            llm=llm_config,
        )
    
    def get_sandbox_config(self) -> dict:
        """Get sandbox configuration based on execution mode.
        
        Returns:
            Sandbox configuration dict for Graphton agent creation.
            
            Local mode:
                {"type": "filesystem", "root_dir": "./workspace"}
            
            Cloud mode:
                {"type": "daytona", "snapshot_id": "..."}  # snapshot_id optional
        """
        if self.mode == "dev":
            return {
                "type": "filesystem",
                "root_dir": self.sandbox_root_dir,
            }
        else:
            # Cloud mode - Daytona configuration
            config = {"type": "daytona"}
            
            # Add optional snapshot ID if configured
            snapshot_id = os.getenv("DAYTONA_DEV_TOOLS_SNAPSHOT_ID")
            if snapshot_id:
                config["snapshot_id"] = snapshot_id
            
            return config
    
    def is_local_mode(self) -> bool:
        """Check if running in local execution mode."""
        return self.mode == "dev"

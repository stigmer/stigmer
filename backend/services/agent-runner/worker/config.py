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
import os


@dataclass
class Config:
    """Worker configuration loaded from environment variables."""
    
    temporal_namespace: str
    temporal_service_address: str
    task_queue: str
    max_concurrency: int
    stigmer_backend_endpoint: str
    stigmer_api_key: str
    
    # Redis configuration
    redis_host: str
    redis_port: int
    redis_password: str | None

    @classmethod
    def load_from_env(cls):
        """Load configuration from environment variables."""
        # Load Stigmer API configuration
        stigmer_api_key = os.getenv("STIGMER_API_KEY", "")
        
        # Validate required Stigmer API configuration
        if not stigmer_api_key:
            raise ValueError("Missing required environment variable: STIGMER_API_KEY")
        
        # Load Redis configuration
        redis_host = os.getenv("REDIS_HOST", "localhost")
        redis_port = int(os.getenv("REDIS_PORT", "6379"))
        redis_password = os.getenv("REDIS_PASSWORD")  # Optional
        
        # Load Temporal task queue for Python activities
        # Environment: TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE
        # Default: "agent_execution_runner"
        task_queue = os.getenv("TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE", "agent_execution_runner")
        
        return cls(
            temporal_namespace=os.getenv("TEMPORAL_NAMESPACE", "default"),
            temporal_service_address=os.getenv("TEMPORAL_SERVICE_ADDRESS", "localhost:7233"),
            task_queue=task_queue,
            max_concurrency=int(os.getenv("TEMPORAL_MAX_CONCURRENCY", "10")),
            stigmer_backend_endpoint=os.getenv("STIGMER_BACKEND_ENDPOINT", "localhost:8080"),
            stigmer_api_key=stigmer_api_key,
            redis_host=redis_host,
            redis_port=redis_port,
            redis_password=redis_password if redis_password else None,
        )

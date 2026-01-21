"""Temporal activity for executing Graphton agents."""

from temporalio import activity
from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentExecution, AgentExecutionStatus
from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import ExecutionPhase
from graphton import create_deep_agent
import logging
import json
from grpc_client.agent_client import AgentClient
from grpc_client.agent_instance_client import AgentInstanceClient
from grpc_client.skill_client import SkillClient
from grpc_client.session_client import SessionClient
from grpc_client.environment_client import EnvironmentClient
from grpc_client.agent_execution_client import AgentExecutionClient
from worker.token_manager import get_api_key
from worker.sandbox_manager import SandboxManager
from worker.activities.graphton.status_builder import StatusBuilder
import os


@activity.defn(name="ExecuteGraphton")
async def execute_graphton(execution: AgentExecution, thread_id: str) -> AgentExecutionStatus:
    """
    Execute Graphton agent and return final status.
    
    Polyglot Workflow Pattern:
    1. Fetches Agent configuration via gRPC
    2. Creates Graphton agent at runtime
    3. Creates/reuses Daytona sandbox
    4. Executes agent and builds status locally
    5. Returns final status to workflow (workflow persists via Java activity)
    
    Args:
        execution: The AgentExecution protobuf
        thread_id: LangGraph thread ID for state persistence
        
    Returns:
        AgentExecutionStatus: Final status with messages, tool_calls, phase
    """
    
    execution_id = execution.metadata.id
    agent_id = execution.spec.agent_id
    user_message = execution.spec.message
    session_id_from_spec = execution.spec.session_id
    
    activity_logger = activity.logger
    activity_logger.info(f"ExecuteGraphton started for execution: {execution_id}")
    
    # Top-level error handler for system errors (e.g., activity not registered, connection failures)
    # This catches errors that occur before the main try block or during initialization
    try:
        return await _execute_graphton_impl(
            execution, thread_id, execution_id, agent_id, user_message, 
            session_id_from_spec, activity_logger
        )
    except Exception as system_error:
        activity_logger.error(f"❌ SYSTEM ERROR in ExecuteGraphton for {execution_id}: {system_error}")
        
        # Create minimal failed status for system errors
        # This handles cases where status_builder was never initialized
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
        from datetime import datetime
        
        failed_status = AgentExecutionStatus(
            phase=ExecutionPhase.EXECUTION_FAILED,
            error=f"System error: {str(system_error)}",
            messages=[
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content="Internal system error occurred. Please contact support if this issue persists.",
                    timestamp=datetime.utcnow().isoformat(),
                ),
                AgentMessage(
                    type=MessageType.MESSAGE_SYSTEM,
                    content=f"Error details: {str(system_error)}",
                    timestamp=datetime.utcnow().isoformat(),
                )
            ]
        )
        
        # Try to update status in database (best effort)
        try:
            api_key = get_api_key()
            if api_key:
                execution_client = AgentExecutionClient(api_key)
                await execution_client.update_status(execution_id, failed_status)
                activity_logger.info(f"✅ Updated execution {execution_id} to FAILED status")
        except Exception as update_error:
            activity_logger.error(f"Failed to update status after system error: {update_error}")
        
        # Return failed status to workflow
        return failed_status


async def _execute_graphton_impl(
    execution: AgentExecution, 
    thread_id: str, 
    execution_id: str, 
    agent_id: str, 
    user_message: str, 
    session_id_from_spec: str,
    activity_logger
) -> AgentExecutionStatus:
    """
    Internal implementation of execute_graphton with existing error handling.
    This function contains the original implementation wrapped in the main try-except.
    """
    activity_logger.info(
        f"Execution parameters: agent_id={agent_id}, "
        f"session_id='{session_id_from_spec}' (empty={not session_id_from_spec})"
    )
    
    # Get API key (for gRPC calls to Stigmer backend)
    api_key = get_api_key()
    if not api_key:
        raise RuntimeError("API key not initialized")
    
    # Initialize gRPC clients (for reading agent configuration, sessions, etc.)
    session_client = SessionClient(api_key)
    agent_instance_client = AgentInstanceClient(api_key)
    agent_client = AgentClient(api_key)
    execution_client = AgentExecutionClient(api_key)
    
    # Initialize status builder (builds status locally, returns to workflow)
    status_builder = StatusBuilder(execution_id, execution.status)
    
    try:
        # Step 1: Resolve the full chain: execution → session → agent_instance → agent
        activity_logger.info(f"Resolving execution chain for execution: {execution_id}")
        
        # 1a. Get session from execution
        session_id = execution.spec.session_id
        if not session_id:
            raise ValueError(
                f"Session ID is required for execution {execution_id}. "
                "Execution must have a valid session_id to proceed."
            )
        
        session = await session_client.get(session_id)
        activity_logger.info(
            f"Session {session_id}: agent_instance_id={session.spec.agent_instance_id}"
        )
        
        # 1b. Get agent instance from session
        agent_instance = await agent_instance_client.get(session.spec.agent_instance_id)
        activity_logger.info(
            f"AgentInstance {session.spec.agent_instance_id}: agent_id={agent_instance.spec.agent_id}"
        )
        
        # 1c. Get agent template
        agent = await agent_client.get(agent_instance.spec.agent_id)
        activity_logger.info(
            f"Agent {agent_instance.spec.agent_id}: name={agent.metadata.name}"
        )
        
        # Extract agent instructions
        instructions = agent.spec.instructions if agent.spec.instructions else "You are a helpful AI assistant."
        
        # Step 2: Get worker configuration (for sandbox and LLM config)
        from worker.config import Config
        worker_config = Config.load_from_env()
        
        # Model name from execution config or worker config (mode-aware default)
        # Priority: execution config > worker LLM config (env vars + mode-aware defaults)
        model_name = (
            execution.spec.execution_config.model_name 
            if execution.spec.execution_config and execution.spec.execution_config.model_name
            else worker_config.llm.model_name
        )
        
        activity_logger.info(
            f"Agent config: model={model_name} (provider={worker_config.llm.provider}), "
            f"instructions_length={len(instructions)}"
        )
        
        # Get sandbox configuration from worker config
        sandbox_config = worker_config.get_sandbox_config()
        
        activity_logger.info(
            f"Sandbox mode: {worker_config.mode} - using {sandbox_config.get('type')} backend"
        )
        
        # Initialize sandbox manager based on mode
        # Note: In local mode (filesystem), SandboxManager is not used
        # The sandbox_config is passed directly to Graphton
        sandbox_manager = None
        if worker_config.mode != "local":
            # Cloud mode - use Daytona SandboxManager
            api_key = os.environ.get("DAYTONA_API_KEY")
            if not api_key:
                raise ValueError("DAYTONA_API_KEY environment variable required for cloud mode")
            
            sandbox_manager = SandboxManager(api_key)
            
            if snapshot_id := sandbox_config.get("snapshot_id"):
                activity_logger.info(f"Using Daytona snapshot: {snapshot_id}")
        
        # Get session_id from execution (if exists)
        resolved_session_id: str | None = execution.spec.session_id if execution.spec.session_id else None
        
        # Handle sandbox based on mode
        sandbox = None
        is_new_sandbox = False
        
        if worker_config.is_local_mode():
            # Local mode - no sandbox management needed
            # Graphton will create filesystem backend from config
            activity_logger.info(
                f"Local mode - using filesystem backend at {sandbox_config.get('root_dir')}"
            )
        else:
            # Cloud mode - get or create Daytona sandbox (reuse if session exists)
            activity_logger.info(
                f"{'Checking for existing sandbox in session' if resolved_session_id else 'Creating ephemeral sandbox'}"
            )
            
            if sandbox_manager is None:
                raise RuntimeError("Sandbox manager not initialized for cloud mode")
            
            sandbox, is_new_sandbox = await sandbox_manager.get_or_create_sandbox(
                sandbox_config=sandbox_config,
                session_id=resolved_session_id,
                session_client=session_client,
            )
            
            activity_logger.info(
                f"Sandbox {'created' if is_new_sandbox else 'reused'}: {sandbox.id} "
                f"for execution {execution_id}"
            )
        
        # Step 3: Fetch and write skills (from agent template via references)
        skills_prompt_section = ""
        skill_refs = agent.spec.skill_refs  # repeated ApiResourceReference
        
        if skill_refs:
            from worker.activities.graphton.skill_writer import SkillWriter
            
            # Create skill client
            skill_client = SkillClient(api_key)
            
            try:
                # Fetch skills via gRPC using ApiResourceReference
                activity_logger.info(
                    f"Fetching {len(skill_refs)} skills: {[ref.slug for ref in skill_refs]}"
                )
                skills = await skill_client.list_by_refs(list(skill_refs))
                
                # Write skills to sandbox (Daytona mode only - local mode not yet supported)
                if worker_config.is_local_mode():
                    # Local mode - skills writing to filesystem not yet implemented
                    activity_logger.warning(
                        "Skills writing to local filesystem is not yet implemented. "
                        "Skills will be skipped in local mode."
                    )
                    skill_paths = {}
                    skills_prompt_section = ""
                else:
                    # Cloud mode - upload to Daytona sandbox
                    if sandbox is None:
                        raise RuntimeError("Sandbox not initialized for cloud mode")
                    
                    activity_logger.info(
                        f"Uploading {len(skills)} skills to Daytona sandbox "
                        f"(sandbox {'newly created' if is_new_sandbox else 'reused, updating skills'})"
                    )
                    skill_writer = SkillWriter(sandbox=sandbox)
                    
                    skill_paths = skill_writer.write_skills(skills)
                    
                    # Generate prompt section with skill metadata
                    skills_prompt_section = SkillWriter.generate_prompt_section(skills, skill_paths)
                    
                    activity_logger.info(
                        f"Successfully uploaded {len(skills)} skills: {[s.metadata.name for s in skills]}"
                    )
                    
            except RuntimeError as e:
                # Catch write/upload failures from SkillWriter
                activity_logger.error(f"Failed to write skills: {e}")
                raise ValueError(f"Skill write failed: {e}") from e
            except Exception as e:
                activity_logger.error(f"Unexpected error preparing skills: {e}")
                raise
        
        # Step 4: Merge environments (if agent instance has environment refs)
        merged_env_vars = {}
        environment_refs = agent_instance.spec.environment_refs
        
        if environment_refs:
            activity_logger.info(
                f"Merging {len(environment_refs)} environments: "
                f"{[ref.slug for ref in environment_refs]}"
            )
            
            try:
                # Create environment client
                environment_client = EnvironmentClient(api_key)
                
                # Fetch environments (preserves order for proper merging)
                environments = await environment_client.list_by_refs(list(environment_refs))
                
                # Merge environments in order (later overrides earlier)
                # Start with agent's base env_spec if it exists
                if agent.spec.env_spec and agent.spec.env_spec.data:
                    # Extract values from EnvironmentValue objects
                    for key, env_value in agent.spec.env_spec.data.items():
                        merged_env_vars[key] = env_value.value
                    activity_logger.info(f"Base env vars from agent: {len(agent.spec.env_spec.data)}")
                
                # Layer each environment (order matters!)
                for idx, env in enumerate(environments):
                    if env.spec.data:
                        # Extract values from EnvironmentValue objects
                        for key, env_value in env.spec.data.items():
                            merged_env_vars[key] = env_value.value
                        activity_logger.info(
                            f"Merged env {idx+1}/{len(environments)} ({env.metadata.name}): "
                            f"{len(env.spec.data)} vars"
                        )
                
                # Runtime env vars from execution have highest priority
                if execution.spec.runtime_env:
                    # Convert ExecutionValue to string values
                    runtime_vars = {
                        key: value.value 
                        for key, value in execution.spec.runtime_env.items()
                    }
                    merged_env_vars.update(runtime_vars)
                    activity_logger.info(f"Applied runtime env overrides: {len(runtime_vars)} vars")
                
                activity_logger.info(f"Final merged environment: {len(merged_env_vars)} total vars")
                
            except Exception as e:
                activity_logger.error(f"Failed to merge environments: {e}")
                # Continue without environments rather than failing execution
                merged_env_vars = {}
        
        # Step 5: Create Graphton agent at runtime with EXISTING sandbox
        activity_logger.info(f"Creating Graphton agent for execution {execution_id}")
        
        # Enhance system prompt with skills section
        enhanced_system_prompt = instructions
        if skills_prompt_section:
            enhanced_system_prompt += skills_prompt_section
            activity_logger.info("Enhanced system prompt with skills metadata")
        
        # Configure sandbox for Graphton agent
        if worker_config.is_local_mode():
            # Local mode - pass filesystem config directly
            sandbox_config_for_agent = sandbox_config.copy()
            activity_logger.info(
                f"Configuring agent for local mode with filesystem backend at {sandbox_config.get('root_dir')}"
            )
        else:
            # Cloud mode - pass Daytona config with sandbox_id to reuse existing sandbox
            if sandbox is None:
                raise RuntimeError("Sandbox not initialized for cloud mode")
            
            sandbox_config_for_agent = {
                "type": "daytona",
                "sandbox_id": sandbox.id,  # Reuse existing sandbox with skills
            }
            activity_logger.info(f"Configuring agent to use existing sandbox {sandbox.id}")
        
        # Create Graphton agent
        # Recursion limit set to 1000 for maximum autonomy
        # Graphton's loop detection middleware prevents infinite loops
        agent_graph = create_deep_agent(
            model=model_name,
            system_prompt=enhanced_system_prompt,
            mcp_servers={},  # MCP support will be added later
            mcp_tools=None,
            subagents=None,  # Sub-agents support will be added later
            sandbox_config=sandbox_config_for_agent,
            recursion_limit=1000,
        )
        
        activity_logger.info(f"Graphton agent created successfully with {'new' if is_new_sandbox else 'reused'} sandbox")
        
        # Step 6: Prepare invocation input
        # Append organization context to message
        context_section = f"\n\n---\nContext:\n- Organization: {execution.metadata.org}"
        message_with_context = user_message + context_section
        
        langgraph_input = {
            "messages": [{"role": "user", "content": message_with_context}]
        }
        
        # Prepare config with thread_id for state persistence
        config = {
            "configurable": {
                "thread_id": thread_id,
                "org": execution.metadata.org,
            }
        }
        
        activity_logger.info(
            f"Using thread_id: {thread_id} for Graphton execution {execution_id}"
        )
        
        # Step 7: Set phase to IN_PROGRESS (status built locally)
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_IN_PROGRESS
        
        activity_logger.info(f"Execution {execution_id} phase set to IN_PROGRESS (building locally)")
        
        # Step 8: Stream execution and build status from events
        events_processed = 0
        last_update_sent = 0
        last_heartbeat_sent = 0
        update_interval = 10  # Send status update every N events
        heartbeat_interval = 5  # Send heartbeat every N events (more frequent than status updates)
        
        activity_logger.info(
            f"🔍 Starting Graphton agent stream for execution {execution_id}"
        )
        
        async for event in agent_graph.astream_events(
            langgraph_input,
            config=config,
            version="v2",  # Use v2 schema for consistent event structure
        ):
            # Process event locally (builds status in memory)
            await status_builder.process_event(event)
            
            events_processed += 1
            
            # Send activity heartbeat to prevent timeout
            # This tells Temporal the activity is still running and making progress
            if events_processed - last_heartbeat_sent >= heartbeat_interval:
                try:
                    activity.heartbeat({
                        "events_processed": events_processed,
                        "messages": len(status_builder.current_status.messages),
                        "tool_calls": len(status_builder.current_status.tool_calls),
                        "phase": status_builder.current_status.phase,
                    })
                    last_heartbeat_sent = events_processed
                except Exception as e:
                    # Heartbeat failure is not critical - log and continue
                    activity_logger.debug(f"Heartbeat failed (event {events_processed}): {e}")
            
            # Send progressive status update via gRPC (every N events)
            if events_processed - last_update_sent >= update_interval:
                try:
                    activity_logger.debug(
                        f"📤 Sending status update #{events_processed}: "
                        f"messages={len(status_builder.current_status.messages)}, "
                        f"tool_calls={len(status_builder.current_status.tool_calls)}"
                    )
                    
                    # Call stigmer-service updateStatus endpoint (merges status)
                    await execution_client.update_status(
                        execution_id=execution_id,
                        status=status_builder.current_status
                    )
                    
                    last_update_sent = events_processed
                    activity_logger.debug(f"✅ Status update sent successfully")
                    
                except Exception as e:
                    # Log but don't fail - keep processing events
                    activity_logger.warning(
                        f"Failed to send status update (event {events_processed}): {e}"
                    )
            
            # Log progress periodically
            if events_processed % 10 == 0:
                activity_logger.debug(f"Processed {events_processed} events")
        
        # Verify stream processed data
        if events_processed == 0:
            raise RuntimeError(
                "Graphton stream completed without processing any events. "
                "This may indicate a configuration error."
            )
        
        activity_logger.info(
            f"📊 Execution {execution_id} completed - processed {events_processed} events"
        )
        
        # Set phase to COMPLETED
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED
        
        # Send final status update via gRPC
        try:
            activity_logger.info(f"📤 Sending FINAL status update")
            await execution_client.update_status(
                execution_id=execution_id,
                status=status_builder.current_status
            )
            activity_logger.info(f"✅ Final status update sent successfully")
        except Exception as e:
            activity_logger.error(f"Failed to send final status update: {e}")
            # Continue - we'll still return status to workflow
        
        # Diagnostic logging for final status
        activity_logger.info("=" * 80)
        activity_logger.info(f"📊 [FINAL_STATUS] Execution {execution_id}:")
        activity_logger.info(f"   messages: {len(status_builder.current_status.messages)}")
        activity_logger.info(f"   tool_calls: {len(status_builder.current_status.tool_calls)}")
        activity_logger.info(f"   sub_agent_executions: {len(status_builder.current_status.sub_agent_executions)}")
        activity_logger.info(f"   todos: {len(status_builder.current_status.todos)}")
        activity_logger.info(f"   phase: {ExecutionPhase.Name(status_builder.current_status.phase)}")
        activity_logger.info("=" * 80)
        
        activity_logger.info(
            f"✅ ExecuteGraphton completed - returning status to workflow for persistence"
        )
        
        # Verify status is not None before returning
        if status_builder.current_status is None:
            activity_logger.error(f"❌ CRITICAL: current_status is None for execution {execution_id}")
            raise RuntimeError("Status builder returned None - this should never happen")
        
        activity_logger.info(
            f"✅ Returning AgentExecutionStatus to workflow: "
            f"type={type(status_builder.current_status).__name__}, "
            f"is_none={status_builder.current_status is None}"
        )
        
        # Return final status to workflow (workflow will call Java persistence activity)
        return status_builder.current_status
    
    except Exception as e:
        activity_logger.error(f"ExecuteGraphton failed for execution {execution_id}: {e}")
        
        # Extract clean error message
        error_str = str(e)
        error_message = f"Execution failed: {error_str}"
        
        # Add error message to status
        from ai.stigmer.agentic.agentexecution.v1.api_pb2 import AgentMessage
        from ai.stigmer.agentic.agentexecution.v1.enum_pb2 import MessageType
        from datetime import datetime
        
        error_msg = AgentMessage(
            type=MessageType.MESSAGE_SYSTEM,
            content=f"❌ Error: {error_message}",
            timestamp=datetime.utcnow().isoformat(),
        )
        
        status_builder.current_status.messages.append(error_msg)
        status_builder.current_status.phase = ExecutionPhase.EXECUTION_FAILED
        
        activity_logger.info(f"Execution {execution_id} phase set to FAILED - returning error status to workflow")
        
        # Verify status is not None before returning
        if status_builder.current_status is None:
            activity_logger.error(f"❌ CRITICAL: current_status is None in error handler for execution {execution_id}")
            raise RuntimeError("Status builder returned None in error handler - this should never happen")
        
        # Send failed status update via gRPC to persist to database
        try:
            activity_logger.info(f"📤 Sending FAILED status update to persist to database")
            await execution_client.update_status(
                execution_id=execution_id,
                status=status_builder.current_status
            )
            activity_logger.info(f"✅ Failed status update sent successfully")
        except Exception as update_error:
            activity_logger.error(f"Failed to send failed status update: {update_error}")
            # Continue - we'll still return status to workflow
        
        activity_logger.info(
            f"✅ Returning failed AgentExecutionStatus to workflow: "
            f"type={type(status_builder.current_status).__name__}"
        )
        
        # Return failed status to workflow (already persisted via gRPC above)
        return status_builder.current_status

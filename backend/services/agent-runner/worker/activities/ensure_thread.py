"""Temporal activity for ensuring session thread exists."""

from temporalio import activity
import logging

activity_logger = logging.getLogger(__name__)


@activity.defn(name="EnsureThread")
async def ensure_thread(session_id: str, agent_id: str) -> str:
    """
    Ensure a thread exists for the given session and agent.
    
    For Graphton agents with LangGraph state persistence, this creates or retrieves
    a thread ID that will be used for conversation history.
    
    Args:
        session_id: The session ID (empty string if no session)
        agent_id: The agent ID
        
    Returns:
        thread_id: The LangGraph thread ID for state persistence
    """
    activity_logger.info(f"EnsureThread called for session: {session_id}, agent: {agent_id}")
    
    # If session exists, use session-based thread ID
    # Otherwise create ephemeral thread ID based on agent
    if session_id:
        thread_id = f"thread-{session_id}"
        activity_logger.info(f"Using session-based thread_id: {thread_id}")
    else:
        # Ephemeral execution without session
        import uuid
        thread_id = f"ephemeral-{agent_id}-{uuid.uuid4().hex[:8]}"
        activity_logger.info(f"Created ephemeral thread_id: {thread_id}")
    
    return thread_id

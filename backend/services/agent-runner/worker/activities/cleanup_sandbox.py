"""Temporal activity for cleaning up Daytona sandboxes."""

from temporalio import activity
from worker.sandbox_manager import SandboxManager
import logging
import os

activity_logger = logging.getLogger(__name__)


@activity.defn(name="CleanupSandbox")
async def cleanup_sandbox(sandbox_id: str) -> None:
    """
    Delete a Daytona sandbox (called on session deletion or timeout).
    
    This is a best-effort cleanup operation. Failures are logged but not raised
    to avoid blocking session deletion workflows.
    
    Args:
        sandbox_id: The Daytona sandbox ID to delete
    """
    activity_logger.info(f"CleanupSandbox called for sandbox: {sandbox_id}")
    
    api_key = os.environ.get("DAYTONA_API_KEY")
    if not api_key:
        activity_logger.error("DAYTONA_API_KEY not configured, cannot cleanup sandbox")
        return
    
    try:
        sandbox_manager = SandboxManager(api_key)
        await sandbox_manager.cleanup_sandbox(sandbox_id)
        activity_logger.info(f"Successfully cleaned up sandbox: {sandbox_id}")
    except Exception as e:
        activity_logger.error(
            f"Failed to cleanup sandbox {sandbox_id}: {e}. "
            "Manual cleanup may be required."
        )
        # Don't raise - best effort cleanup

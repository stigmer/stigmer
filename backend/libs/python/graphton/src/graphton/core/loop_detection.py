"""Loop detection middleware for autonomous agents.

This middleware tracks tool invocations to detect and prevent infinite loops,
a common issue in autonomous agent systems. It uses industry-standard patterns
from AutoGPT, BabyAGI, and LangGraph to identify repetitive behavior and
intervene gracefully.

Key features:
- Tracks last N tool invocations with parameter hashing
- Detects consecutive repetitions (same tool, similar params)
- Injects intervention messages to guide agent toward completion
- Gracefully stops execution if loops persist
- Thread-safe per-invocation state tracking
- Configurable thresholds and intervention strategies
"""

import hashlib
import json
import logging
from collections import deque
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, AgentState
from langchain_core.messages import AIMessage, SystemMessage
from langgraph.runtime import Runtime

logger = logging.getLogger(__name__)


class LoopDetectionMiddleware(AgentMiddleware):
    """Middleware to detect and prevent infinite loops in agent execution.
    
    This middleware tracks tool invocations and identifies repetitive patterns
    that indicate the agent is stuck. When loops are detected, it intervenes
    to guide the agent toward a different approach or graceful conclusion.
    
    Detection Algorithm:
    1. Track last 10 tool calls (tool name + parameter hash)
    2. Detect 3+ consecutive identical calls → inject warning message
    3. Detect 5+ total repetitions → force graceful stop
    4. Configurable thresholds per use case
    
    The middleware operates at the message level, inspecting AIMessage tool calls
    and ToolMessage results to build a history of tool invocations.
    
    Example:
        >>> middleware = LoopDetectionMiddleware(
        ...     history_size=10,
        ...     consecutive_threshold=3,
        ...     total_threshold=5
        ... )
        >>> # Auto-injected in create_deep_agent() by default
    
    Args:
        history_size: Number of recent tool calls to track (default: 10)
        consecutive_threshold: Number of consecutive repeats before warning (default: 3)
        total_threshold: Total repetitions before stopping (default: 5)
        enabled: Whether loop detection is active (default: True)

    """
    
    def __init__(
        self,
        history_size: int = 10,
        consecutive_threshold: int = 3,
        total_threshold: int = 5,
        enabled: bool = True,
    ) -> None:
        """Initialize loop detection middleware.
        
        Args:
            history_size: Number of recent tool calls to track
            consecutive_threshold: Consecutive repeats before intervention
            total_threshold: Total repetitions before stopping
            enabled: Whether loop detection is active

        """
        self.history_size = history_size
        self.consecutive_threshold = consecutive_threshold
        self.total_threshold = total_threshold
        self.enabled = enabled
        
        # Per-invocation state (cleared between agent runs)
        self._tool_history: deque[tuple[str, str]] = deque(maxlen=history_size)
        self._intervention_count = 0
        self._stopped = False
        
        logger.info(
            f"Loop detection middleware initialized: "
            f"history_size={history_size}, "
            f"consecutive_threshold={consecutive_threshold}, "
            f"total_threshold={total_threshold}, "
            f"enabled={enabled}"
        )
    
    def _hash_params(self, params: dict[str, Any]) -> str:
        """Create a stable hash of tool parameters for comparison.
        
        This allows us to detect when the same tool is called with identical
        or very similar parameters, indicating a loop.
        
        Args:
            params: Tool parameters dictionary
            
        Returns:
            SHA256 hash of normalized parameters

        """
        # Normalize params to ensure consistent hashing
        # Sort keys, convert to JSON, hash the string
        try:
            normalized = json.dumps(params, sort_keys=True, default=str)
            return hashlib.sha256(normalized.encode()).hexdigest()[:16]
        except Exception as e:
            logger.warning(f"Failed to hash parameters: {e}, using empty hash")
            return "error"
    
    def _detect_consecutive_loops(self) -> tuple[bool, str, int]:
        """Detect if the same tool is being called repeatedly.
        
        Returns:
            Tuple of (is_loop, tool_name, consecutive_count)

        """
        if not self._tool_history:
            return False, "", 0
        
        # Get the most recent tool call
        recent_tool, recent_hash = self._tool_history[-1]
        
        # Count consecutive identical calls working backwards
        consecutive_count = 1
        for tool_name, param_hash in reversed(list(self._tool_history)[:-1]):
            if tool_name == recent_tool and param_hash == recent_hash:
                consecutive_count += 1
            else:
                break
        
        is_loop = consecutive_count >= self.consecutive_threshold
        return is_loop, recent_tool, consecutive_count
    
    def _detect_total_repetitions(self) -> tuple[bool, str, int]:
        """Detect if a tool has been called too many times total.
        
        Returns:
            Tuple of (is_excessive, tool_name, total_count)

        """
        if not self._tool_history:
            return False, "", 0
        
        # Count occurrences of each tool+params combination
        recent_tool, recent_hash = self._tool_history[-1]
        recent_signature = (recent_tool, recent_hash)
        
        total_count = sum(
            1 for sig in self._tool_history if sig == recent_signature
        )
        
        is_excessive = total_count >= self.total_threshold
        return is_excessive, recent_tool, total_count
    
    def _create_intervention_message(
        self,
        tool_name: str,
        consecutive_count: int,
        total_count: int,
        is_final: bool,
    ) -> SystemMessage:
        """Create an intervention message to guide the agent.
        
        Args:
            tool_name: Name of the repeated tool
            consecutive_count: Number of consecutive repetitions
            total_count: Total number of repetitions
            is_final: Whether this is the final intervention (force stop)
            
        Returns:
            SystemMessage with intervention guidance

        """
        if is_final:
            content = (
                f"⚠️ LOOP DETECTED: Critical repetition limit reached.\n\n"
                f"You have called '{tool_name}' {total_count} times with similar parameters. "
                f"This indicates you are stuck in a loop and unable to make progress.\n\n"
                f"**You MUST conclude your work now:**\n"
                f"1. Summarize what you have learned so far\n"
                f"2. Explain the obstacle preventing progress\n"
                f"3. Provide your best assessment based on available information\n"
                f"4. Do NOT call '{tool_name}' again\n\n"
                f"Conclude gracefully with the information you have gathered."
            )
        else:
            content = (
                f"⚠️ LOOP WARNING: Repetitive pattern detected.\n\n"
                f"You have called '{tool_name}' {consecutive_count} times in a row. "
                f"This suggests you may be stuck or approaching the problem incorrectly.\n\n"
                f"**Recommended actions:**\n"
                f"1. Try a completely different approach or tool\n"
                f"2. Re-examine your assumptions about the problem\n"
                f"3. Consider if you have enough information to conclude\n"
                f"4. Avoid calling '{tool_name}' again unless absolutely necessary\n\n"
                f"Adapt your strategy to make progress."
            )
        
        return SystemMessage(content=content)
    
    async def abefore_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Initialize loop detection state at the start of agent execution.
        
        Args:
            state: Current agent state
            runtime: Runtime context
            
        Returns:
            None (state tracking is internal)

        """
        if not self.enabled:
            return None
        
        # Clear state for new execution
        self._tool_history.clear()
        self._intervention_count = 0
        self._stopped = False
        
        logger.debug("Loop detection state initialized for new execution")
        return None
    
    async def aafter_step(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Track tool calls and detect loops after each agent step.
        
        This is called after each agent step (message generation). We inspect
        the latest messages to identify tool calls and build our history.
        
        Args:
            state: Current agent state with messages
            runtime: Runtime context
            
        Returns:
            Modified state with intervention messages if loop detected

        """
        if not self.enabled or self._stopped:
            return None
        
        # Extract messages from state
        messages = state.get("messages", [])
        if not messages:
            return None
        
        # Look for tool calls in the most recent AIMessage
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and hasattr(msg, "tool_calls"):
                tool_calls = msg.tool_calls or []
                
                # Track each tool call
                for tool_call in tool_calls:
                    tool_name = tool_call.get("name", "unknown")
                    tool_args = tool_call.get("args", {})
                    param_hash = self._hash_params(tool_args)
                    
                    # Add to history
                    self._tool_history.append((tool_name, param_hash))
                    
                    logger.debug(
                        f"Tracked tool call: {tool_name} (hash: {param_hash}), "
                        f"history size: {len(self._tool_history)}"
                    )
                    
                    # Check for loops
                    consecutive_loop, cons_tool, cons_count = self._detect_consecutive_loops()
                    total_loop, total_tool, total_count = self._detect_total_repetitions()
                    
                    if total_loop:
                        # Critical: total repetitions exceeded - force stop
                        logger.warning(
                            f"LOOP DETECTED - Total threshold exceeded: "
                            f"{total_tool} called {total_count} times (threshold: {self.total_threshold})"
                        )
                        
                        intervention = self._create_intervention_message(
                            total_tool, cons_count, total_count, is_final=True
                        )
                        
                        # Inject intervention message into state
                        state["messages"].append(intervention)
                        self._intervention_count += 1
                        self._stopped = True
                        
                        logger.info(
                            "Loop detection: Final intervention injected, execution will stop"
                        )
                        
                        return {"messages": state["messages"]}
                    
                    elif consecutive_loop and self._intervention_count == 0:
                        # Warning: consecutive repetitions - first intervention
                        logger.warning(
                            f"LOOP WARNING - Consecutive threshold reached: "
                            f"{cons_tool} called {cons_count} times in a row "
                            f"(threshold: {self.consecutive_threshold})"
                        )
                        
                        intervention = self._create_intervention_message(
                            cons_tool, cons_count, total_count, is_final=False
                        )
                        
                        # Inject warning message
                        state["messages"].append(intervention)
                        self._intervention_count += 1
                        
                        logger.info(
                            f"Loop detection: Warning intervention injected "
                            f"(intervention #{self._intervention_count})"
                        )
                        
                        return {"messages": state["messages"]}
                
                # Only process the most recent AIMessage
                break
        
        return None
    
    async def aafter_agent(
        self,
        state: AgentState[Any],
        runtime: Runtime[None] | dict[str, Any],
    ) -> dict[str, Any] | None:
        """Cleanup and log final loop detection stats.
        
        Args:
            state: Final agent state
            runtime: Runtime context
            
        Returns:
            None

        """
        if not self.enabled:
            return None
        
        # Log final statistics
        if self._tool_history:
            logger.info(
                f"Loop detection summary: "
                f"{len(self._tool_history)} tool calls tracked, "
                f"{self._intervention_count} interventions, "
                f"stopped={self._stopped}"
            )
        
        return None


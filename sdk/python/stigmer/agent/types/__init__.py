"""
Common types and type definitions for the agent SDK.
"""

from typing import Union

# Agent reference can be an ID string or an Agent object
AgentReference = Union[str, "Agent"]

__all__ = [
    "AgentReference",
]

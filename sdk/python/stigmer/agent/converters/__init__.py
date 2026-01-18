"""
Proto converters for Agent SDK classes.
"""

import sys
from pathlib import Path

# Add proto stubs to Python path
# This is needed because the SDK package name 'stigmer' shadows the proto stubs 'stigmer' namespace
_proto_stubs_path = Path(__file__).parent.parent.parent.parent.parent.parent / "apis" / "stubs" / "python"
if _proto_stubs_path.exists() and str(_proto_stubs_path) not in sys.path:
    sys.path.insert(0, str(_proto_stubs_path))

from stigmer.agent.converters.agent_converter import AgentConverter

__all__ = [
    "AgentConverter",
]

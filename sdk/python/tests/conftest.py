"""
Pytest configuration for Stigmer SDK tests.

Configures Python path to include proto stubs for testing.
"""

import sys
from pathlib import Path

# Add proto stubs to Python path FIRST, before any imports
# The proto stubs are in apis/stubs/python/stigmer/ and should be imported as "from ai.stigmer..."
proto_stubs_path = Path(__file__).parent.parent.parent.parent / "apis" / "stubs" / "python" / "stigmer"

if proto_stubs_path.exists():
    proto_stubs_str = str(proto_stubs_path)
    # Add proto stubs at the VERY beginning so it's found first
    if proto_stubs_str not in sys.path:
        sys.path.insert(0, proto_stubs_str)

#!/usr/bin/env python3
"""
Quick integration test for local Graphton dependency.
Tests that agent-runner can import and use Graphton.
"""

import sys
from pathlib import Path

def test_graphton_imports():
    """Test that all Graphton imports work."""
    print("Testing Graphton imports...")
    
    try:
        # Main API (as used by agent-runner)
        from graphton import create_deep_agent, AgentConfig
        
        # Template utilities
        from graphton import extract_template_vars, has_templates, substitute_templates
        
        # Middleware
        from graphton import McpToolsLoader
        
        print("✅ All Graphton imports successful")
        print(f"   - create_deep_agent: {create_deep_agent.__name__}")
        print(f"   - AgentConfig: {AgentConfig.__name__}")
        return True
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False

def test_agent_config():
    """Test creating a basic agent configuration."""
    print("\nTesting AgentConfig creation...")
    
    try:
        from graphton import AgentConfig
        
        config = AgentConfig(
            model="claude-sonnet-4-20250514",
            system_prompt="You are a helpful assistant.",
            recursion_limit=100
        )
        
        print(f"✅ AgentConfig created successfully")
        print(f"   - Model: {config.model}")
        print(f"   - System prompt: {config.system_prompt[:40]}...")
        print(f"   - Recursion limit: {config.recursion_limit}")
        return True
    except Exception as e:
        print(f"❌ AgentConfig creation failed: {e}")
        return False

def test_template_utilities():
    """Test template utility functions."""
    print("\nTesting template utilities...")
    
    try:
        from graphton import has_templates, extract_template_vars, substitute_templates
        
        # Test has_templates
        assert has_templates("API_KEY={{token}}") == True
        assert has_templates("no templates here") == False
        
        # Test extract_template_vars
        vars = extract_template_vars({"auth": "Bearer {{token}}", "user": "{{user_id}}"})
        assert "token" in vars
        assert "user_id" in vars
        
        # Test substitute_templates
        result = substitute_templates("Hello {{name}}", {"name": "World"})
        assert result == "Hello World"
        
        print(f"✅ Template utilities working correctly")
        print(f"   - has_templates: ✓")
        print(f"   - extract_template_vars: ✓")
        print(f"   - substitute_templates: ✓")
        return True
    except Exception as e:
        print(f"❌ Template utilities failed: {e}")
        return False

def test_sandbox_config():
    """Test sandbox configuration in AgentConfig."""
    print("\nTesting sandbox configuration...")
    
    try:
        from graphton import AgentConfig
        import tempfile
        
        with tempfile.TemporaryDirectory() as tmpdir:
            config = AgentConfig(
                model="claude-sonnet-4-20250514",
                system_prompt="Test agent",
                sandbox_config={
                    "type": "filesystem",
                    "root_dir": tmpdir
                }
            )
            
            print(f"✅ Sandbox config created successfully")
            print(f"   - Sandbox type: {config.sandbox_config['type']}")
            print(f"   - Root dir: {config.sandbox_config['root_dir']}")
            return True
    except Exception as e:
        print(f"❌ Sandbox config failed: {e}")
        return False

def main():
    """Run all tests."""
    print("=" * 70)
    print("Graphton Integration Test")
    print("=" * 70)
    
    tests = [
        test_graphton_imports,
        test_agent_config,
        test_template_utilities,
        test_sandbox_config,
    ]
    
    results = []
    for test in tests:
        results.append(test())
    
    print("\n" + "=" * 70)
    print(f"Results: {sum(results)}/{len(results)} tests passed")
    print("=" * 70)
    
    if all(results):
        print("\n✅ ALL TESTS PASSED - Graphton integration is working!")
        return 0
    else:
        print("\n❌ SOME TESTS FAILED - See errors above")
        return 1

if __name__ == "__main__":
    sys.exit(main())

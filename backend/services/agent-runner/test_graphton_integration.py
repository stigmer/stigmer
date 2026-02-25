#!/usr/bin/env python3
"""
Quick integration test for local Graphton dependency.
Tests that agent-runner can import and use Graphton.
"""

import sys


def test_graphton_imports():
    """Test that all Graphton imports work."""
    print("Testing Graphton imports...")
    
    # Main API (as used by agent-runner)
    # Template utilities
    # Middleware
    from graphton import (
        AgentConfig,
        create_deep_agent,
    )
    
    print("✅ All Graphton imports successful")
    print(f"   - create_deep_agent: {create_deep_agent.__name__}")
    print(f"   - AgentConfig: {AgentConfig.__name__}")

def test_agent_config():
    """Test creating a basic agent configuration."""
    print("\nTesting AgentConfig creation...")
    
    from graphton import AgentConfig
    
    config = AgentConfig(
        model="claude-sonnet-4-20250514",
        system_prompt="You are a helpful assistant.",
        recursion_limit=100
    )
    
    assert config.model == "claude-sonnet-4-20250514"
    assert config.system_prompt == "You are a helpful assistant."
    assert config.recursion_limit == 100
    
    print("✅ AgentConfig created successfully")
    print(f"   - Model: {config.model}")
    print(f"   - System prompt: {config.system_prompt[:40]}...")
    print(f"   - Recursion limit: {config.recursion_limit}")

def test_template_utilities():
    """Test template utility functions."""
    print("\nTesting template utilities...")
    
    from graphton import extract_template_vars, has_templates, substitute_templates
    
    # Test has_templates
    assert has_templates("API_KEY={{token}}")
    assert not has_templates("no templates here")
    
    # Test extract_template_vars
    vars = extract_template_vars({"auth": "Bearer {{token}}", "user": "{{user_id}}"})
    assert "token" in vars
    assert "user_id" in vars
    
    # Test substitute_templates
    result = substitute_templates("Hello {{name}}", {"name": "World"})
    assert result == "Hello World"
    
    print("✅ Template utilities working correctly")
    print("   - has_templates: ✓")
    print("   - extract_template_vars: ✓")
    print("   - substitute_templates: ✓")

def test_sandbox_config():
    """Test sandbox configuration in AgentConfig."""
    print("\nTesting sandbox configuration...")
    
    import tempfile

    from graphton import AgentConfig
    
    with tempfile.TemporaryDirectory() as tmpdir:
        config = AgentConfig(
            model="claude-sonnet-4-20250514",
            system_prompt="Test agent",
            sandbox_config={
                "type": "filesystem",
                "root_dir": tmpdir
            }
        )
        
        assert config.sandbox_config["type"] == "filesystem"
        assert config.sandbox_config["root_dir"] == tmpdir
        
        print("✅ Sandbox config created successfully")
        print(f"   - Sandbox type: {config.sandbox_config['type']}")
        print(f"   - Root dir: {config.sandbox_config['root_dir']}")

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

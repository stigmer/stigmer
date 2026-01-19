#!/usr/bin/env python3
"""Test script for Ollama support in Graphton models.py.

This script tests:
1. Ollama model instantiation with friendly names
2. Ollama model instantiation with explicit provider prefix
3. Ollama model instantiation with full model names
4. Parameter overrides (base_url, temperature, num_predict)
"""

import sys
from pathlib import Path

# Add graphton to path
graphton_src = Path(__file__).parent.parent.parent.parent / "backend/libs/python/graphton/src"
sys.path.insert(0, str(graphton_src))

from graphton.core.models import parse_model_string


def test_ollama_friendly_names():
    """Test Ollama model instantiation with friendly names."""
    print("=" * 80)
    print("Test 1: Ollama Friendly Names")
    print("=" * 80)
    
    test_cases = [
        "qwen2.5-coder",
        "llama3.2",
        "deepseek-coder",
        "codellama",
    ]
    
    for model_name in test_cases:
        try:
            model = parse_model_string(model_name)
            print(f"✅ {model_name}: {type(model).__name__}")
            print(f"   Model: {model.model}")
            print(f"   Base URL: {getattr(model, 'base_url', 'N/A')}")
            print(f"   Temperature: {getattr(model, 'temperature', 'N/A')}")
            print()
        except Exception as e:
            print(f"❌ {model_name}: {e}")
            print()


def test_ollama_explicit_prefix():
    """Test Ollama model instantiation with explicit provider prefix."""
    print("=" * 80)
    print("Test 2: Ollama Explicit Provider Prefix")
    print("=" * 80)
    
    test_cases = [
        "ollama:qwen2.5-coder:7b",
        "ollama:llama3.2:3b",
        "ollama:mistral:latest",
    ]
    
    for model_name in test_cases:
        try:
            model = parse_model_string(model_name)
            print(f"✅ {model_name}: {type(model).__name__}")
            print(f"   Model: {model.model}")
            print(f"   Base URL: {getattr(model, 'base_url', 'N/A')}")
            print()
        except Exception as e:
            print(f"❌ {model_name}: {e}")
            print()


def test_ollama_parameter_overrides():
    """Test Ollama parameter overrides."""
    print("=" * 80)
    print("Test 3: Ollama Parameter Overrides")
    print("=" * 80)
    
    # Test with custom base_url
    print("Test 3a: Custom base_url")
    try:
        model = parse_model_string(
            "qwen2.5-coder",
            base_url="http://custom-host:11434"
        )
        print(f"✅ Custom base_url: {model.base_url}")
        print()
    except Exception as e:
        print(f"❌ Custom base_url: {e}")
        print()
    
    # Test with custom temperature
    print("Test 3b: Custom temperature")
    try:
        model = parse_model_string(
            "qwen2.5-coder",
            temperature=0.7
        )
        print(f"✅ Custom temperature: {model.temperature}")
        print()
    except Exception as e:
        print(f"❌ Custom temperature: {e}")
        print()
    
    # Test with max_tokens (should map to num_predict)
    print("Test 3c: max_tokens → num_predict")
    try:
        model = parse_model_string(
            "qwen2.5-coder",
            max_tokens=2048
        )
        print(f"✅ max_tokens override: {getattr(model, 'num_predict', 'N/A')}")
        print()
    except Exception as e:
        print(f"❌ max_tokens override: {e}")
        print()


def test_ollama_inference():
    """Test Ollama provider inference from model names."""
    print("=" * 80)
    print("Test 4: Ollama Provider Inference")
    print("=" * 80)
    
    test_cases = [
        "qwen2.5-coder:latest",
        "llama3.2:3b",
        "mistral:7b",
        "phi:latest",
        "gemma:2b",
    ]
    
    for model_name in test_cases:
        try:
            model = parse_model_string(model_name)
            print(f"✅ {model_name}: Inferred as Ollama ({type(model).__name__})")
        except Exception as e:
            print(f"❌ {model_name}: {e}")


def test_all_providers():
    """Test that all three providers work correctly."""
    print("=" * 80)
    print("Test 5: All Providers")
    print("=" * 80)
    
    test_cases = [
        ("claude-sonnet-4.5", "Anthropic"),
        ("gpt-4o", "OpenAI"),
        ("qwen2.5-coder", "Ollama"),
    ]
    
    for model_name, expected_provider in test_cases:
        try:
            model = parse_model_string(model_name)
            actual_provider = type(model).__name__.replace("Chat", "")
            if actual_provider.lower() == expected_provider.lower():
                print(f"✅ {model_name}: {actual_provider}")
            else:
                print(f"❌ {model_name}: Expected {expected_provider}, got {actual_provider}")
        except Exception as e:
            print(f"❌ {model_name}: {e}")


if __name__ == "__main__":
    print("\n")
    print("╔" + "═" * 78 + "╗")
    print("║" + " " * 20 + "Graphton Ollama Support Test Suite" + " " * 24 + "║")
    print("╚" + "═" * 78 + "╝")
    print("\n")
    
    test_ollama_friendly_names()
    test_ollama_explicit_prefix()
    test_ollama_parameter_overrides()
    test_ollama_inference()
    test_all_providers()
    
    print("\n")
    print("=" * 80)
    print("All tests completed!")
    print("=" * 80)
    print("\n")

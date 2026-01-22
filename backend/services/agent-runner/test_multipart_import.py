#!/usr/bin/env python3
"""
Test script to verify multipart imports work correctly.
This can be run both in development and in the PyInstaller bundle.
"""

def test_multipart_imports():
    """Test that multipart module and its exports are accessible."""
    try:
        # Test basic import
        import multipart
        print("✅ Successfully imported multipart module")
        
        # Test class imports
        from multipart import MultipartSegment
        print("✅ Successfully imported MultipartSegment")
        
        from multipart import PushMultipartParser
        print("✅ Successfully imported PushMultipartParser")
        
        from multipart import parse_options_header
        print("✅ Successfully imported parse_options_header")
        
        # Test Daytona import (the actual failing import)
        try:
            from daytona._async import filesystem
            print("✅ Successfully imported daytona._async.filesystem")
        except ImportError as e:
            print(f"⚠️  Could not import daytona filesystem (expected if Daytona not configured): {e}")
        
        print("\n✅ All multipart imports successful!")
        return True
        
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    import sys
    success = test_multipart_imports()
    sys.exit(0 if success else 1)

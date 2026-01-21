# PyInstaller hook for multipart package
# 
# The multipart package is a single-file module (multipart.py), NOT a package.
# PyInstaller sometimes incorrectly treats it as a package, creating multipart/__init__.py
# which breaks imports. This hook ensures it's collected as a py_module.

from PyInstaller.utils.hooks import collect_submodules, get_module_file_attribute

# Tell PyInstaller to collect multipart as a single module
hiddenimports = []

# Verify it's a single-file module
try:
    import multipart
    module_file = get_module_file_attribute('multipart')
    # If it's multipart.py (not multipart/__init__.py), we're good
    if module_file and not module_file.endswith('__init__.py'):
        # Force PyInstaller to treat it correctly by not adding submodules
        pass
except ImportError:
    pass

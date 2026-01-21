# -*- mode: python ; coding: utf-8 -*-

# PyInstaller spec file for agent-runner
# Optimized for production binary builds
# 
# Build outputs:
#   - dist/agent-runner (executable binary)
#   - build/ (build cache)
# 
# Both directories are in .gitignore and will NOT be committed

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        # Add any configuration files or templates here if needed
        # Example: ('config/*.yaml', 'config'),
    ],
    hiddenimports=[
        # Temporal SDK
        'temporalio',
        'temporalio.worker',
        'temporalio.client',
        'temporalio.common',
        
        # LangGraph and LangChain
        'langgraph',
        'langchain',
        'langchain_core',
        'langchain_core.messages',
        'langchain_core.prompts',
        
        # gRPC and protobuf
        'grpc',
        'google.protobuf',
        
        # Local packages
        'graphton',
        
        # Daytona sandbox support
        'daytona',
        'deepagents_cli',
        
        # Authentication
        'authlib',
        'httpx',
        'jwt',
        
        # Redis
        'redis',
        'redis.asyncio',
        
        # Environment and config
        'dotenv',
        
        # Standard library modules that might be missed
        'asyncio',
        'logging',
        'signal',
        'multiprocessing',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # GUI frameworks (not needed)
        'tkinter',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
        
        # Plotting libraries (not needed)
        'matplotlib',
        'seaborn',
        
        # Interactive shells (not needed)
        'IPython',
        'jupyter',
        'notebook',
        
        # Testing frameworks (dev only)
        'pytest',
        'pytest_asyncio',
        'unittest',
        
        # Linting/type checking (dev only)
        'pylint',
        'flake8',
        'mypy',
        
        # Large unnecessary modules
        'scipy',
        'pandas',
        'numpy.distutils',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='agent-runner',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,  # Enable UPX compression if available
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Keep console for logging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

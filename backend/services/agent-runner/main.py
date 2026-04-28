"""Backward-compatible entry point. Delegates to stigmer_runner.__main__."""

from stigmer_runner.__main__ import main

if __name__ == "__main__":
    main()

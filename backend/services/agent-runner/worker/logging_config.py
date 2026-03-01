"""Logging configuration for agent-runner service.

Uses dictConfig with a YAML file (logging.yaml), the Python equivalent of
Spring Boot's application.yml logging section.  dictConfig replaces the
entire logging tree atomically, so there are no ordering issues with
imports that create loggers before setup_logging() runs.

The LOG_LEVEL environment variable overrides the root logger level at
startup (default: INFO).
"""

import logging.config
import os
from pathlib import Path

import yaml


def setup_logging() -> None:
    """Load logging configuration from logging.yaml and apply it.

    The root logger level is overridden by the LOG_LEVEL env var when set.
    All per-logger levels are declared in logging.yaml.
    """
    config_path = Path(__file__).parent / "logging.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    log_level = os.getenv("LOG_LEVEL", "").upper()
    if log_level:
        config["root"]["level"] = log_level

    logging.config.dictConfig(config)

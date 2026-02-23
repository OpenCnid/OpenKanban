#!/usr/bin/env python3
"""Shared utilities for Content Scout scripts."""

from __future__ import annotations

import json
import logging
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from slugify import slugify

ROOT_DIR = Path(__file__).resolve().parents[2]


class ContentScoutError(RuntimeError):
    """Raised when a deterministic pipeline step cannot continue."""


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def resolve_path(path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path
    return ROOT_DIR / path


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_json(path: Path, default: Any | None = None) -> Any:
    if not path.exists():
        if default is not None:
            return default
        raise FileNotFoundError(path)
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)


def run_command(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def utcnow() -> datetime:
    return datetime.now(UTC)


def utc_today_str() -> str:
    return utcnow().date().isoformat()


def parse_upload_date(value: str) -> datetime | None:
    """Parse yt-dlp upload_date (`YYYYMMDD`) into UTC datetime."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value, "%Y%m%d")
    except ValueError:
        return None
    return dt.replace(tzinfo=UTC)


def normalize_slug(value: str) -> str:
    return slugify(value) if value else ""

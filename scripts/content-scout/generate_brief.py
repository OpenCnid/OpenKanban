#!/usr/bin/env python3
"""Generate a daily markdown brief from frame annotations and watchlist context."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any

from anthropic import Anthropic

from _common import ensure_dir, load_json, resolve_path, setup_logging

LOGGER = logging.getLogger("content_scout.generate_brief")

BRIEF_INSTRUCTIONS = """
You are producing a position-aware daily competitor content brief for Hans.

Use the provided annotations and watchlist. Output markdown with exactly these sections:
1. Position Alerts — competitor analysis on Hans's positions
2. Top Themes — consensus views + contrarian angles
3. Best Visuals — relevance 4-5 with timestamp links
4. Content Opportunities — gaps + edge
5. Ticker Heatmap — all tickers + sentiment + key levels

Requirements:
- Be concise and actionable.
- Include timestamp URLs when available.
- If data is missing, state assumptions explicitly.
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", default="tmp/annotations.json", help="Annotations JSON path")
    parser.add_argument(
        "--watchlist",
        default="config/content-scout/watchlist.json",
        help="Watchlist JSON path",
    )
    parser.add_argument(
        "--output",
        default="content-vault/daily/_daily-brief.md",
        help="Output markdown path",
    )
    parser.add_argument(
        "--model",
        default="claude-opus-4-20250514",
        help="Anthropic model for brief generation",
    )
    parser.add_argument("--verbose", action="store_true", help="Enable debug logs")
    return parser.parse_args()


def build_prompt(annotations: list[dict[str, Any]], watchlist: dict[str, Any]) -> str:
    kept = [item for item in annotations if item.get("kept")]
    return (
        f"{BRIEF_INSTRUCTIONS}\n\n"
        "Watchlist JSON:\n"
        f"{json.dumps(watchlist, indent=2, ensure_ascii=False)}\n\n"
        "Frame Annotations JSON:\n"
        f"{json.dumps(kept, indent=2, ensure_ascii=False)}\n"
    )


def extract_response_text(response: Any) -> str:
    parts: list[str] = []
    for block in getattr(response, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def main() -> int:
    args = parse_args()
    setup_logging(args.verbose)

    annotations_path = resolve_path(args.annotations)
    watchlist_path = resolve_path(args.watchlist)
    output_path = resolve_path(args.output)

    annotations = load_json(annotations_path, default=[])
    watchlist = load_json(watchlist_path, default={})

    if not isinstance(annotations, list):
        raise ValueError(f"Annotations file must contain a list: {annotations_path}")

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is required for daily brief generation")

    client = Anthropic()
    prompt = build_prompt(annotations, watchlist)

    response = client.messages.create(
        model=args.model,
        max_tokens=4096,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )

    markdown = extract_response_text(response)
    if not markdown:
        markdown = "# Daily Brief\n\nNo content generated."

    ensure_dir(output_path.parent)
    output_path.write_text(markdown, encoding="utf-8")

    LOGGER.info("Daily brief written to %s", output_path)
    print(f"Generated daily brief at {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

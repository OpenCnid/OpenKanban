#!/usr/bin/env python3
"""Classify and annotate frames using Anthropic vision models."""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from anthropic import Anthropic

from _common import ROOT_DIR, load_json, resolve_path, save_json, setup_logging

LOGGER = logging.getLogger("content_scout.classify_annotate")

PROMPT_TEMPLATE = """You are a stock/options trading analyst reviewing frames from a competitor's YouTube video.
Video: {title} by {channel}
For EACH frame, provide classification and (if relevant) annotation.

Categories: CHART, GRAPH, TABLE, SLIDE, SCREEN, TALKING_HEAD, FILLER
If TALKING_HEAD or FILLER, return classification only.
If CHART/GRAPH/TABLE/SLIDE/SCREEN with confidence >= 0.7, annotate:
- what: description
- key_data: array of data points
- verbal_context: what presenter says
- insight: analytical insight
- relevance: 1-5
- tags: array
- content_angle: content opportunity
- ticker: string or null
- timeframe: string or null
- indicators: array

Respond as JSON array.
"""

ALLOWED_CATEGORIES = {"CHART", "GRAPH", "TABLE", "SLIDE", "SCREEN"}
JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="tmp/windowed_frames.json", help="Windowed frames JSON path")
    parser.add_argument("--batch-size", type=int, default=5, help="Number of frames per API call")
    parser.add_argument(
        "--model",
        default="claude-sonnet-4-20250514",
        help="Anthropic model name",
    )
    parser.add_argument(
        "--confidence-threshold",
        type=float,
        default=0.7,
        help="Minimum confidence required for kept annotations",
    )
    parser.add_argument("--output", default="tmp/annotations.json", help="Output annotations JSON path")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logs")
    return parser.parse_args()


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def resolve_frame_path(frame_path: str) -> Path:
    candidate = Path(frame_path)
    if candidate.is_absolute():
        return candidate
    return ROOT_DIR / candidate


def image_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".jpg" or suffix == ".jpeg":
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    return "image/png"


def encode_image(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def extract_text_blocks(response: Any) -> str:
    content = getattr(response, "content", None)
    if not content:
        return ""
    parts: list[str] = []
    for block in content:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def parse_json_array(raw_text: str) -> list[dict[str, Any]]:
    text = raw_text.strip()
    if not text:
        return []

    try:
        payload = json.loads(text)
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
    except json.JSONDecodeError:
        pass

    fence_match = JSON_BLOCK_RE.search(text)
    if fence_match:
        try:
            payload = json.loads(fence_match.group(1).strip())
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, dict)]
        except json.JSONDecodeError:
            pass

    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            payload = json.loads(text[start : end + 1])
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, dict)]
        except json.JSONDecodeError:
            pass

    LOGGER.warning("Could not parse model response as JSON array")
    return []


def normalize_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def normalize_category(value: Any) -> str:
    category = str(value or "FILLER").strip().upper()
    if not category:
        category = "FILLER"
    return category


def normalize_annotation(frame: dict[str, Any], model_payload: dict[str, Any], threshold: float) -> dict[str, Any]:
    category = normalize_category(model_payload.get("category"))
    try:
        confidence = float(model_payload.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0

    relevance_value = model_payload.get("relevance")
    try:
        relevance = int(relevance_value) if relevance_value is not None else None
    except (TypeError, ValueError):
        relevance = None

    kept = category in ALLOWED_CATEGORIES and confidence >= threshold

    return {
        "videoId": frame.get("videoId"),
        "videoTitle": frame.get("videoTitle"),
        "channelName": frame.get("channelName"),
        "channelSlug": frame.get("channelSlug"),
        "framePath": frame.get("framePath"),
        "timestamp": frame.get("timestamp"),
        "sourceUrl": frame.get("sourceUrl"),
        "transcriptWindow": frame.get("transcriptWindow", ""),
        "category": category,
        "confidence": confidence,
        "kept": kept,
        "description": model_payload.get("what") or model_payload.get("description"),
        "key_data": normalize_tags(model_payload.get("key_data")),
        "verbal_context": model_payload.get("verbal_context"),
        "insight": model_payload.get("insight"),
        "relevance": relevance,
        "tags": normalize_tags(model_payload.get("tags")),
        "content_angle": model_payload.get("content_angle"),
        "ticker": model_payload.get("ticker"),
        "timeframe": model_payload.get("timeframe"),
        "indicators": normalize_tags(model_payload.get("indicators")),
        "raw": model_payload,
    }


def build_batch_request(batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []

    for idx, frame in enumerate(batch, start=1):
        frame_path = str(frame.get("framePath") or "")
        transcript = str(frame.get("transcriptWindow") or "")
        content.append(
            {
                "type": "text",
                "text": (
                    "Frame {index}:\n"
                    "framePath: {frame_path}\n"
                    "videoId: {video_id}\n"
                    "timestamp: {timestamp}\n"
                    "sourceUrl: {source_url}\n"
                    "transcriptWindow: {transcript}\n"
                ).format(
                    index=idx,
                    frame_path=frame_path,
                    video_id=frame.get("videoId", ""),
                    timestamp=frame.get("timestamp", ""),
                    source_url=frame.get("sourceUrl", ""),
                    transcript=transcript,
                ),
            }
        )

        resolved = resolve_frame_path(frame_path)
        if not resolved.exists():
            LOGGER.warning("Frame image missing: %s", resolved)
            continue

        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image_media_type(resolved),
                    "data": encode_image(resolved),
                },
            }
        )

    content.append(
        {
            "type": "text",
            "text": (
                "Return a JSON array only. One object per input frame. "
                "Each object MUST include: framePath, category, confidence, what, key_data, verbal_context, "
                "insight, relevance, tags, content_angle, ticker, timeframe, indicators."
            ),
        }
    )
    return content


def find_payload_for_frame(frame: dict[str, Any], payloads: list[dict[str, Any]], index: int) -> dict[str, Any]:
    frame_path = str(frame.get("framePath") or "")

    for payload in payloads:
        if str(payload.get("framePath") or "") == frame_path:
            return payload

    for payload in payloads:
        payload_index = payload.get("frameIndex")
        try:
            if int(payload_index) == index:
                return payload
        except (TypeError, ValueError):
            continue

    if index - 1 < len(payloads):
        return payloads[index - 1]

    return {"category": "FILLER", "confidence": 0.0}


def main() -> int:
    args = parse_args()
    setup_logging(args.verbose)

    input_path = resolve_path(args.input)
    output_path = resolve_path(args.output)
    frames = load_json(input_path, default=[])

    if not isinstance(frames, list):
        raise ValueError(f"Expected list input: {input_path}")

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is required for classification")

    client = Anthropic()

    annotations: list[dict[str, Any]] = []
    kept = 0
    discarded = 0

    for batch in chunked(frames, max(1, args.batch_size)):
        title = str(batch[0].get("videoTitle") or "Unknown Video")
        channel = str(batch[0].get("channelName") or "Unknown Channel")
        prompt = PROMPT_TEMPLATE.format(title=title, channel=channel)
        content = [{"type": "text", "text": prompt}, *build_batch_request(batch)]

        try:
            response = client.messages.create(
                model=args.model,
                max_tokens=4096,
                temperature=0,
                messages=[{"role": "user", "content": content}],
            )
            payload_text = extract_text_blocks(response)
            parsed = parse_json_array(payload_text)
        except Exception as exc:  # noqa: BLE001
            LOGGER.exception("Anthropic batch call failed: %s", exc)
            parsed = []

        for index, frame in enumerate(batch, start=1):
            model_payload = find_payload_for_frame(frame, parsed, index)
            normalized = normalize_annotation(frame, model_payload, args.confidence_threshold)
            annotations.append(normalized)
            if normalized["kept"]:
                kept += 1
            else:
                discarded += 1

    save_json(output_path, annotations)
    LOGGER.info(
        "Classification complete (total=%s kept=%s discarded=%s)",
        len(annotations),
        kept,
        discarded,
    )
    print(f"Classified {len(annotations)} frames (kept {kept}, discarded {discarded})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

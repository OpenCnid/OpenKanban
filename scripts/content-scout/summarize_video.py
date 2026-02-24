#!/usr/bin/env python3
"""Generate a structured video summary from transcript and optional annotations."""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from _common import ContentScoutError, load_json, resolve_path, save_json, setup_logging

LOGGER = logging.getLogger("content_scout.summarize_video")

DEFAULT_MODELS = {
    "anthropic": "claude-opus-4-20250514",
    "openai": "gpt-5.2",
}

JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
EXCLUDED_CATEGORIES = {"TALKING_HEAD", "FILLER"}

SUMMARY_INSTRUCTIONS = """You are producing a neutral, professional summary package for a video transcript.

Return ONE JSON object only (no markdown, no commentary) using exactly this shape:
{
  "takeaways": [{"text": "...", "timestamp": "MM:SS", "timestamp_seconds": 0}],
  "chapters": [{"title": "...", "timestamp": "MM:SS", "timestamp_seconds": 0}],
  "shorts": [{
    "start": "MM:SS",
    "end": "MM:SS",
    "start_seconds": 0,
    "end_seconds": 0,
    "hook": "...",
    "payoff": "...",
    "on_screen_text": "6 words max",
    "cta": "..."
  }],
  "slide_suggestions": [{"text": "...", "timestamp": "MM:SS"}]
}

Requirements:
- Tone must stay neutral and professional.
- Use transcript evidence, not hype.
- takeaways: 5-10 items.
- chapters: 8-14 items in chronological order.
- shorts: 10-14 items in chronological order.
- on_screen_text must be <= 6 words.
- Prefer exact transcript timestamps; if uncertain, use nearest segment timestamp.
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--transcript",
        required=True,
        help="Path to {video_id}_transcript.json produced by transcribe_local.py",
    )
    parser.add_argument(
        "--annotations",
        default=None,
        help="Optional path to annotations.json produced by classify_annotate.py",
    )
    parser.add_argument("--output", required=True, help="Path to write summary.json")
    parser.add_argument("--provider", choices=["anthropic", "openai", "auto"], default="auto")
    parser.add_argument("--model", default=None, help="Model name (default: provider-specific)")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logs")
    return parser.parse_args()


def detect_provider(requested: str) -> str:
    if requested != "auto":
        return requested

    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    has_openai = bool(os.environ.get("OPENAI_API_KEY"))

    if has_anthropic:
        return "anthropic"
    if has_openai:
        return "openai"

    raise ContentScoutError("No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.")


def coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def format_timestamp(seconds: int) -> str:
    total = max(0, int(seconds))
    minutes, secs = divmod(total, 60)
    return f"{minutes:02d}:{secs:02d}"


def parse_timestamp_to_seconds(value: Any) -> int | None:
    if value is None:
        return None

    parsed_int = coerce_int(value)
    if parsed_int is not None and not isinstance(value, str):
        return max(0, parsed_int)

    text = str(value).strip()
    if not text:
        return None

    if text.isdigit():
        return max(0, int(text))

    parts = text.split(":")
    if len(parts) not in (2, 3):
        return None
    try:
        nums = [int(part) for part in parts]
    except ValueError:
        return None

    if len(nums) == 2:
        minutes, secs = nums
        if minutes < 0 or secs < 0:
            return None
        return minutes * 60 + secs

    hours, minutes, secs = nums
    if hours < 0 or minutes < 0 or secs < 0:
        return None
    return (hours * 3600) + (minutes * 60) + secs


def derive_seconds(item: dict[str, Any], second_keys: list[str], label_keys: list[str]) -> int:
    for key in second_keys:
        parsed = coerce_int(item.get(key))
        if parsed is not None:
            return max(0, parsed)
    for key in label_keys:
        parsed = parse_timestamp_to_seconds(item.get(key))
        if parsed is not None:
            return max(0, parsed)
    return 0


def normalize_transcript_segments(payload: Any) -> list[dict[str, Any]]:
    raw_segments: Any
    if isinstance(payload, dict):
        raw_segments = payload.get("segments", [])
    elif isinstance(payload, list):
        raw_segments = payload
    else:
        raise ContentScoutError("Transcript file must contain an object or an array")

    if not isinstance(raw_segments, list):
        raise ContentScoutError("Transcript segments must be a list")

    segments: list[dict[str, Any]] = []
    for raw in raw_segments:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        start = max(0.0, coerce_float(raw.get("start"), 0.0))
        end = max(start, coerce_float(raw.get("end"), start))
        speaker = str(raw.get("speaker") or "Speaker 1")
        segments.append(
            {
                "start": start,
                "end": end,
                "speaker": speaker,
                "text": text,
            }
        )

    segments.sort(key=lambda segment: segment["start"])
    return segments


def compact_transcript_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "start": round(segment["start"], 2),
            "end": round(segment["end"], 2),
            "speaker": segment["speaker"],
            "text": segment["text"],
        }
        for segment in segments
    ]


def normalize_annotations(payload: Any) -> list[dict[str, Any]]:
    if payload is None:
        return []
    if not isinstance(payload, list):
        raise ContentScoutError("Annotations must be a list")

    visuals: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        if not item.get("kept"):
            continue
        category = str(item.get("category") or "").strip().upper()
        if category in EXCLUDED_CATEGORIES:
            continue
        timestamp = max(0, int(coerce_float(item.get("timestamp"), 0.0)))
        visuals.append(
            {
                "timestamp_seconds": timestamp,
                "timestamp": format_timestamp(timestamp),
                "category": category,
                "description": str(item.get("description") or "").strip(),
                "verbal_context": str(item.get("verbal_context") or "").strip(),
                "sourceUrl": item.get("sourceUrl"),
            }
        )
    visuals.sort(key=lambda item: item["timestamp_seconds"])
    return visuals


def transcript_metadata(transcript_payload: Any, transcript_path: Path, segments: list[dict[str, Any]]) -> dict[str, Any]:
    payload = transcript_payload if isinstance(transcript_payload, dict) else {}
    video_id = str(payload.get("videoId") or transcript_path.stem.replace("_transcript", ""))
    return {
        "videoId": video_id,
        "videoTitle": str(payload.get("videoTitle") or ""),
        "channelName": str(payload.get("channelName") or ""),
        "url": payload.get("url"),
        "duration_seconds": int(max((segment["end"] for segment in segments), default=0.0)),
    }


def build_prompt(
    metadata: dict[str, Any],
    segments: list[dict[str, Any]],
    visual_annotations: list[dict[str, Any]],
) -> str:
    payload = {
        "video": metadata,
        "transcript_segments": compact_transcript_segments(segments),
        "visual_annotations": visual_annotations,
    }
    return f"{SUMMARY_INSTRUCTIONS}\n\nINPUT_DATA_JSON:\n{json.dumps(payload, ensure_ascii=False)}"


def call_anthropic(prompt: str, model: str) -> str:
    from anthropic import Anthropic

    client = Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}],
    )

    parts: list[str] = []
    for block in getattr(response, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def call_openai(prompt: str, model: str) -> str:
    from openai import OpenAI

    client = OpenAI()
    lower_model = model.lower()
    is_reasoning = any(tag in lower_model for tag in ("gpt-5", "o3", "o4"))
    token_kwarg = "max_completion_tokens" if is_reasoning else "max_tokens"
    token_limit = 16384 if is_reasoning else 4096
    extra_kwargs = {} if is_reasoning else {"temperature": 0.2}

    response = client.chat.completions.create(
        model=model,
        **{token_kwarg: token_limit},
        **extra_kwargs,
        messages=[{"role": "user", "content": prompt}],
    )

    usage = getattr(response, "usage", None)
    if usage:
        LOGGER.info(
            "Token usage: prompt=%s completion=%s total=%s",
            getattr(usage, "prompt_tokens", "?"),
            getattr(usage, "completion_tokens", "?"),
            getattr(usage, "total_tokens", "?"),
        )

    return (response.choices[0].message.content or "").strip()


def parse_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if not text:
        return {}

    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    match = JSON_BLOCK_RE.search(text)
    if match:
        try:
            payload = json.loads(match.group(1).strip())
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            payload = json.loads(text[start : end + 1])
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass

    LOGGER.warning("Could not parse model response as JSON object")
    return {}


def trim_words(text: str, max_words: int) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]).strip()


def normalize_takeaways(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("takeaway") or "").strip()
        if not text:
            continue
        seconds = derive_seconds(item, ["timestamp_seconds", "seconds"], ["timestamp", "time"])
        normalized.append(
            {
                "text": text,
                "timestamp": format_timestamp(seconds),
                "timestamp_seconds": seconds,
            }
        )
    normalized.sort(key=lambda item: item["timestamp_seconds"])
    return normalized[:10]


def normalize_chapters(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("text") or "").strip()
        if not title:
            continue
        seconds = derive_seconds(item, ["timestamp_seconds", "seconds"], ["timestamp", "time"])
        normalized.append(
            {
                "title": title,
                "timestamp": format_timestamp(seconds),
                "timestamp_seconds": seconds,
            }
        )
    normalized.sort(key=lambda item: item["timestamp_seconds"])
    return normalized[:14]


def normalize_shorts(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        start_seconds = derive_seconds(item, ["start_seconds"], ["start", "start_timestamp"])
        end_seconds = derive_seconds(item, ["end_seconds"], ["end", "end_timestamp"])
        if end_seconds < start_seconds:
            end_seconds = start_seconds

        hook = str(item.get("hook") or "").strip()
        payoff = str(item.get("payoff") or "").strip()
        cta = str(item.get("cta") or "").strip()
        on_screen_text = trim_words(str(item.get("on_screen_text") or "").strip(), 6)

        if not hook and not payoff:
            continue

        normalized.append(
            {
                "start": format_timestamp(start_seconds),
                "end": format_timestamp(end_seconds),
                "start_seconds": start_seconds,
                "end_seconds": end_seconds,
                "hook": hook,
                "payoff": payoff,
                "on_screen_text": on_screen_text,
                "cta": cta,
            }
        )

    normalized.sort(key=lambda item: item["start_seconds"])
    return normalized[:14]


def normalize_slide_suggestions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("suggestion") or "").strip()
        if not text:
            continue
        seconds = derive_seconds(item, ["timestamp_seconds", "seconds"], ["timestamp", "time"])
        normalized.append(
            {
                "text": text,
                "timestamp": format_timestamp(seconds),
            }
        )
    return normalized


def normalize_summary(payload: dict[str, Any]) -> dict[str, Any]:
    takeaways = normalize_takeaways(payload.get("takeaways"))
    chapters = normalize_chapters(payload.get("chapters"))
    shorts = normalize_shorts(payload.get("shorts"))
    slide_suggestions = normalize_slide_suggestions(
        payload.get("slide_suggestions", payload.get("slides"))
    )

    if chapters and len(chapters) < 8:
        LOGGER.warning("Model returned %d chapters (expected 8-14)", len(chapters))
    if shorts and len(shorts) < 10:
        LOGGER.warning("Model returned %d shorts (expected 10-14)", len(shorts))

    return {
        "takeaways": takeaways,
        "chapters": chapters,
        "shorts": shorts,
        "slide_suggestions": slide_suggestions,
    }


def main() -> int:
    args = parse_args()
    setup_logging(args.verbose)

    try:
        transcript_path = resolve_path(args.transcript)
        output_path = resolve_path(args.output)

        transcript_payload = load_json(transcript_path, default={})
        segments = normalize_transcript_segments(transcript_payload)
        if not segments:
            raise ContentScoutError(f"Transcript has no usable segments: {transcript_path}")

        annotations_payload: Any = []
        if args.annotations:
            annotations_path = resolve_path(args.annotations)
            annotations_payload = load_json(annotations_path, default=[])
        visual_annotations = normalize_annotations(annotations_payload)

        metadata = transcript_metadata(transcript_payload, transcript_path, segments)
        prompt = build_prompt(metadata, segments, visual_annotations)

        provider = detect_provider(args.provider)
        model = args.model or DEFAULT_MODELS[provider]
        LOGGER.info("Using provider=%s model=%s", provider, model)

        call_fn = call_anthropic if provider == "anthropic" else call_openai
        raw_response = call_fn(prompt, model)
        parsed = parse_json_object(raw_response)
        summary = normalize_summary(parsed)

        save_json(output_path, summary)
        LOGGER.info(
            "Summary written to %s (takeaways=%s chapters=%s shorts=%s slides=%s)",
            output_path,
            len(summary["takeaways"]),
            len(summary["chapters"]),
            len(summary["shorts"]),
            len(summary["slide_suggestions"]),
        )
        print(
            "Generated summary at "
            f"{output_path} via {provider}/{model} "
            f"(takeaways={len(summary['takeaways'])}, chapters={len(summary['chapters'])}, "
            f"shorts={len(summary['shorts'])})"
        )
        return 0
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("summarize_video failed: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

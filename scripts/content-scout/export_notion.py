#!/usr/bin/env python3
"""Export transcript, visuals, and summary into a Transcript Studio Notion page."""

from __future__ import annotations

import argparse
import logging
import os
import time
from datetime import date
from typing import Any
from urllib.parse import urljoin

from notion_client import Client

from _common import ContentScoutError, load_json, resolve_path, setup_logging

LOGGER = logging.getLogger("content_scout.export_notion")

MAX_RICH_TEXT_CHARS = 1900
MAX_BLOCKS_PER_APPEND = 100


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--transcript",
        required=True,
        help="Path to {video_id}_transcript.json produced by transcribe_local.py",
    )
    parser.add_argument(
        "--merged",
        required=True,
        help="Path to merged_transcript.json produced by merge_visuals.py",
    )
    parser.add_argument(
        "--summary",
        required=True,
        help="Path to summary.json produced by summarize_video.py",
    )
    parser.add_argument(
        "--database-id",
        default=os.environ.get("NOTION_TRANSCRIPT_DB", ""),
        help="Notion Transcript Studio database ID",
    )
    parser.add_argument("--token", default=os.environ.get("NOTION_TOKEN", ""), help="Notion API token")
    parser.add_argument(
        "--image-base-url",
        default="",
        help="Optional URL prefix for visual image_path values (external Notion image embeds)",
    )
    parser.add_argument("--delay", type=float, default=0.35, help="Rate limit delay between API calls")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logs")
    return parser.parse_args()


def normalize_text(value: Any, fallback: str = "") -> str:
    return str(value or fallback).strip()


def coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def format_timestamp(seconds: int) -> str:
    total = max(0, int(seconds))
    minutes, secs = divmod(total, 60)
    return f"{minutes:02d}:{secs:02d}"


def split_text_chunks(content: str, max_chars: int = MAX_RICH_TEXT_CHARS) -> list[str]:
    text = str(content or "")
    if not text:
        return []

    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break

        split_at = max(
            remaining.rfind("\n", 0, max_chars + 1),
            remaining.rfind(" ", 0, max_chars + 1),
        )
        if split_at <= 0:
            split_at = max_chars

        chunk = remaining[:split_at].rstrip()
        if not chunk:
            chunk = remaining[:max_chars]
            split_at = max_chars

        chunks.append(chunk)
        remaining = remaining[split_at:].lstrip()

    return chunks


def to_plain_text_objects(content: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": {"content": chunk}} for chunk in split_text_chunks(content)]


def to_rich_text_objects(content: str, *, bold: bool = False) -> list[dict[str, Any]]:
    rich: list[dict[str, Any]] = []
    for chunk in split_text_chunks(content):
        text_obj: dict[str, Any] = {"type": "text", "text": {"content": chunk}}
        if bold:
            text_obj["annotations"] = {"bold": True}
        rich.append(text_obj)
    return rich


def to_title(content: str) -> list[dict[str, Any]]:
    title = normalize_text(content, "Untitled")
    return to_plain_text_objects(title)[:1]


def to_property_rich_text(content: str) -> list[dict[str, Any]]:
    value = normalize_text(content)
    return to_plain_text_objects(value) if value else []


def paragraph_block(content: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {"rich_text": to_rich_text_objects(content)},
    }


def speaker_paragraph_block(speaker: str, content: str) -> dict[str, Any]:
    rich_text = to_rich_text_objects(f"{speaker}: ", bold=True) + to_rich_text_objects(content)
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {"rich_text": rich_text},
    }


def heading_block(
    level: int,
    content: str,
    *,
    is_toggleable: bool = False,
    children: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    heading_type = f"heading_{level}"
    payload: dict[str, Any] = {
        "object": "block",
        "type": heading_type,
        heading_type: {
            "rich_text": to_rich_text_objects(content),
            "is_toggleable": is_toggleable,
        },
    }
    if children:
        payload["children"] = children
    return payload


def callout_block(content: str, *, emoji: str = "ℹ️") -> dict[str, Any]:
    return {
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": to_rich_text_objects(content),
            "icon": {"type": "emoji", "emoji": emoji},
        },
    }


def numbered_list_item_block(content: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "numbered_list_item",
        "numbered_list_item": {"rich_text": to_rich_text_objects(content)},
    }


def bulleted_list_item_block(content: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {"rich_text": to_rich_text_objects(content)},
    }


def image_block(url: str) -> dict[str, Any]:
    return {
        "object": "block",
        "type": "image",
        "image": {"type": "external", "external": {"url": url}},
    }


def table_row_block(cells: list[str]) -> dict[str, Any]:
    normalized_cells: list[list[dict[str, Any]]] = []
    for cell in cells:
        rich = to_rich_text_objects(cell)
        if not rich:
            rich = [{"type": "text", "text": {"content": ""}}]
        normalized_cells.append(rich)
    return {
        "object": "block",
        "type": "table_row",
        "table_row": {"cells": normalized_cells},
    }


def table_block(rows: list[list[str]]) -> dict[str, Any]:
    table_rows = [table_row_block(["Timestamp", "Type", "Description"])]
    table_rows.extend(table_row_block(row) for row in rows)
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": 3,
            "has_column_header": True,
            "children": table_rows,
        },
    }


def safe_call(action: str, fn: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("Notion %s failed: %s", action, exc)
        raise


def normalize_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_segments = payload.get("segments", [])
    if not isinstance(raw_segments, list):
        return []

    segments: list[dict[str, Any]] = []
    for raw in raw_segments:
        if not isinstance(raw, dict):
            continue
        text = normalize_text(raw.get("text"))
        if not text:
            continue
        start = max(0.0, coerce_float(raw.get("start"), 0.0))
        end = max(start, coerce_float(raw.get("end"), start))
        speaker = normalize_text(raw.get("speaker"), "Speaker 1")
        segments.append(
            {
                "start": start,
                "end": end,
                "speaker": speaker,
                "text": text,
            }
        )
    segments.sort(key=lambda item: item["start"])
    return segments


def duration_minutes(segments: list[dict[str, Any]]) -> float:
    max_end = max((coerce_float(segment.get("end"), 0.0) for segment in segments), default=0.0)
    return round(max_end / 60.0, 2)


def speaker_count(payload: dict[str, Any], segments: list[dict[str, Any]]) -> int:
    from_payload = payload.get("speakers", [])
    if isinstance(from_payload, list):
        seen = {normalize_text(speaker) for speaker in from_payload if normalize_text(speaker)}
        if seen:
            return len(seen)

    seen_from_segments = {
        normalize_text(segment.get("speaker"), "Speaker 1")
        for segment in segments
        if normalize_text(segment.get("speaker"), "Speaker 1")
    }
    return len(seen_from_segments)


def build_page_metadata(payload: dict[str, Any], segments: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "video_title": normalize_text(payload.get("videoTitle"), "Untitled Video"),
        "channel_name": normalize_text(payload.get("channelName"), "Unknown"),
        "source_url": normalize_text(payload.get("url")),
        "video_id": normalize_text(payload.get("videoId")),
        "duration_minutes": duration_minutes(segments),
        "speakers": speaker_count(payload, segments),
        "today": date.today().isoformat(),
        "preset": normalize_text(payload.get("preset")),
        "playlist": normalize_text(payload.get("playlist")),
        "tags": payload.get("tags", []),
    }


def build_page_properties(metadata: dict[str, Any]) -> dict[str, Any]:
    properties: dict[str, Any] = {
        "Name": {"title": to_title(f"{metadata['video_title']} — {metadata['channel_name']}")},
        "Date": {"date": {"start": metadata["today"]}},
        "Channel": {"select": {"name": metadata["channel_name"][:100]}},
        "Status": {"select": {"name": "Ready"}},
        "Source URL": {"url": metadata["source_url"] or None},
        "Video ID": {"rich_text": to_property_rich_text(metadata["video_id"])},
        "Duration": {"number": metadata["duration_minutes"]},
        "Speakers": {"number": metadata["speakers"]},
    }

    preset = normalize_text(metadata.get("preset"))
    if preset:
        properties["Preset"] = {"select": {"name": preset[:100]}}

    playlist = normalize_text(metadata.get("playlist"))
    if playlist:
        properties["Playlist"] = {"select": {"name": playlist[:100]}}

    raw_tags = metadata.get("tags", [])
    if isinstance(raw_tags, list):
        tags = [normalize_text(tag)[:100] for tag in raw_tags if normalize_text(tag)]
        if tags:
            properties["Tags"] = {"multi_select": [{"name": tag} for tag in tags]}

    return properties


def build_metadata_callout(metadata: dict[str, Any]) -> dict[str, Any]:
    source_line = f"Source: {metadata['source_url']}" if metadata["source_url"] else "Source: n/a"
    info_line = (
        f"Speakers: {metadata['speakers']} | Duration: {metadata['duration_minutes']} minutes"
    )
    date_line = f"Date: {metadata['today']}"
    preset = normalize_text(metadata.get("preset"))
    preset_line = f"Preset: {preset}" if preset else "Preset: n/a"
    content = "\n".join([source_line, info_line, date_line, preset_line])
    return callout_block(content, emoji="📺")


def timestamp_from_summary_item(item: dict[str, Any], label_key: str, seconds_key: str) -> str:
    label = normalize_text(item.get(label_key))
    if label:
        return label
    seconds = int(max(0.0, coerce_float(item.get(seconds_key), 0.0)))
    return format_timestamp(seconds)


def summary_takeaway_children(summary_payload: dict[str, Any]) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    raw_takeaways = summary_payload.get("takeaways", [])
    if isinstance(raw_takeaways, list):
        for item in raw_takeaways:
            if not isinstance(item, dict):
                continue
            text = normalize_text(item.get("text"))
            if not text:
                continue
            timestamp = timestamp_from_summary_item(item, "timestamp", "timestamp_seconds")
            children.append(numbered_list_item_block(f"{text} ({timestamp})"))
    if not children:
        children.append(numbered_list_item_block("No key takeaways generated."))
    return children


def summary_chapter_children(summary_payload: dict[str, Any]) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    raw_chapters = summary_payload.get("chapters", [])
    if isinstance(raw_chapters, list):
        for item in raw_chapters:
            if not isinstance(item, dict):
                continue
            title = normalize_text(item.get("title"), normalize_text(item.get("text")))
            if not title:
                continue
            timestamp = timestamp_from_summary_item(item, "timestamp", "timestamp_seconds")
            children.append(numbered_list_item_block(f"{timestamp} {title}"))
    if not children:
        children.append(numbered_list_item_block("No chapters generated."))
    return children


def summary_shorts_children(summary_payload: dict[str, Any]) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    raw_shorts = summary_payload.get("shorts", [])
    if isinstance(raw_shorts, list):
        for item in raw_shorts:
            if not isinstance(item, dict):
                continue

            start = timestamp_from_summary_item(item, "start", "start_seconds")
            end = timestamp_from_summary_item(item, "end", "end_seconds")
            hook = normalize_text(item.get("hook"))
            payoff = normalize_text(item.get("payoff"))
            cta = normalize_text(item.get("cta"))
            on_screen = normalize_text(item.get("on_screen_text"))

            if not hook and not payoff and not cta and not on_screen:
                continue

            parts = [f"[{start} -> {end}]"]
            if hook:
                parts.append(f"Hook: {hook}")
            if payoff:
                parts.append(f"Payoff: {payoff}")
            if on_screen:
                parts.append(f"On-screen: {on_screen}")
            if cta:
                parts.append(f"CTA: {cta}")
            children.append(numbered_list_item_block(" | ".join(parts)))

    if not children:
        children.append(numbered_list_item_block("No shorts/clip candidates generated."))
    return children


def summary_slide_children(summary_payload: dict[str, Any]) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    raw_slides = summary_payload.get("slide_suggestions", summary_payload.get("slides", []))
    if isinstance(raw_slides, list):
        for item in raw_slides:
            if not isinstance(item, dict):
                continue
            text = normalize_text(item.get("text"), normalize_text(item.get("suggestion")))
            if not text:
                continue
            timestamp = timestamp_from_summary_item(item, "timestamp", "timestamp_seconds")
            children.append(bulleted_list_item_block(f"{timestamp} - {text}"))
    if not children:
        children.append(bulleted_list_item_block("No slide/graphic notes generated."))
    return children


def build_summary_blocks(summary_payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        heading_block(1, "Summary"),
        heading_block(
            2,
            "Key Takeaways",
            is_toggleable=True,
            children=summary_takeaway_children(summary_payload),
        ),
        heading_block(
            2,
            "Chapters",
            is_toggleable=True,
            children=summary_chapter_children(summary_payload),
        ),
        heading_block(
            2,
            "Shorts/Clip Candidates",
            is_toggleable=True,
            children=summary_shorts_children(summary_payload),
        ),
        heading_block(
            2,
            "Slide/Graphic Notes",
            is_toggleable=True,
            children=summary_slide_children(summary_payload),
        ),
    ]


def visual_timestamp(item: dict[str, Any]) -> str:
    label = normalize_text(item.get("timestamp_label"))
    if label:
        return label

    timestamp = item.get("timestamp")
    as_text = normalize_text(timestamp)
    if as_text and ":" in as_text:
        return as_text
    if as_text.isdigit():
        return format_timestamp(int(as_text))

    seconds = int(max(0.0, coerce_float(item.get("timestamp_seconds"), 0.0)))
    return format_timestamp(seconds)


def visual_type(item: dict[str, Any]) -> str:
    for key in ("visual_type", "visualType", "label", "category"):
        value = normalize_text(item.get(key))
        if value:
            return value
    return "Visual"


def resolve_image_url(base_url: str, image_path: str) -> str:
    clean_base = normalize_text(base_url)
    clean_path = normalize_text(image_path)
    if not clean_base:
        return ""
    if not clean_path:
        return ""
    if clean_path.startswith(("http://", "https://")):
        return clean_path
    if clean_path.startswith("./"):
        clean_path = clean_path[2:]
    return urljoin(clean_base.rstrip("/") + "/", clean_path.lstrip("/"))


def build_transcript_blocks(
    merged_payload: list[dict[str, Any]],
    image_base_url: str,
) -> tuple[list[dict[str, Any]], list[list[str]]]:
    blocks: list[dict[str, Any]] = [heading_block(1, "Transcript with Visuals")]
    visual_rows: list[list[str]] = []

    for item in merged_payload:
        if not isinstance(item, dict):
            continue
        block_type = normalize_text(item.get("type")).lower()

        if block_type == "timestamp":
            label = normalize_text(item.get("value"), visual_timestamp(item))
            if label:
                blocks.append(heading_block(3, label))
            continue

        if block_type == "text":
            speaker = normalize_text(item.get("speaker"), "Speaker 1")
            text = normalize_text(item.get("text"))
            if text:
                blocks.append(speaker_paragraph_block(speaker, text))
            continue

        if block_type != "visual":
            continue

        timestamp = visual_timestamp(item)
        v_type = visual_type(item)
        description = normalize_text(item.get("description"), "No description")
        caption = f"[Visual @ {timestamp} — {v_type}] {description}"
        blocks.append(paragraph_block(caption))

        image_path = normalize_text(item.get("image_path"), normalize_text(item.get("imagePath")))
        image_url = resolve_image_url(image_base_url, image_path)
        if image_url:
            blocks.append(image_block(image_url))
        else:
            blocks.append(callout_block(f"{v_type} @ {timestamp}: {description}", emoji="🖼️"))

        visual_rows.append([timestamp, v_type, description])

    if len(blocks) == 1:
        blocks.append(paragraph_block("No merged transcript blocks were found."))

    return blocks, visual_rows


def build_visual_index_toggle(visual_rows: list[list[str]]) -> dict[str, Any]:
    rows = visual_rows if visual_rows else [["--", "--", "No visuals found."]]
    return heading_block(
        1,
        "Visual Index",
        is_toggleable=True,
        children=[table_block(rows)],
    )


def split_raw_transcript(raw_text: str) -> list[str]:
    clean = raw_text.replace("\r\n", "\n").strip()
    if not clean:
        return []

    chunks: list[str] = []
    for paragraph in clean.split("\n\n"):
        para = paragraph.strip()
        if not para:
            continue
        chunks.extend(split_text_chunks(para))
    if chunks:
        return chunks
    return split_text_chunks(clean)


def build_raw_transcript_toggle(payload: dict[str, Any], segments: list[dict[str, Any]]) -> dict[str, Any]:
    raw_text = normalize_text(payload.get("raw_text"), normalize_text(payload.get("text")))
    if not raw_text:
        raw_text = " ".join(
            normalize_text(segment.get("text"))
            for segment in segments
            if normalize_text(segment.get("text"))
        )

    chunks = split_raw_transcript(raw_text)
    children = [paragraph_block(chunk) for chunk in chunks]
    if not children:
        children = [paragraph_block("No raw transcript text available.")]

    return heading_block(1, "Raw Transcript", is_toggleable=True, children=children)


def build_page_blocks(
    transcript_payload: dict[str, Any],
    merged_payload: list[dict[str, Any]],
    summary_payload: dict[str, Any],
    image_base_url: str,
) -> list[dict[str, Any]]:
    segments = normalize_segments(transcript_payload)
    metadata = build_page_metadata(transcript_payload, segments)

    blocks: list[dict[str, Any]] = [build_metadata_callout(metadata)]
    blocks.extend(build_summary_blocks(summary_payload))

    transcript_blocks, visual_rows = build_transcript_blocks(merged_payload, image_base_url)
    blocks.extend(transcript_blocks)
    blocks.append(build_visual_index_toggle(visual_rows))
    blocks.append(build_raw_transcript_toggle(transcript_payload, segments))
    return blocks


def append_blocks(notion: Client, page_id: str, blocks: list[dict[str, Any]], delay: float) -> int:
    failed_calls = 0
    for start in range(0, len(blocks), MAX_BLOCKS_PER_APPEND):
        chunk = blocks[start : start + MAX_BLOCKS_PER_APPEND]
        try:
            safe_call(
                "children append",
                notion.blocks.children.append,
                block_id=page_id,
                children=chunk,
            )
        except Exception:
            failed_calls += 1
        time.sleep(delay)
    return failed_calls


def main() -> int:
    args = parse_args()
    setup_logging(args.verbose)

    try:
        if not args.database_id:
            raise RuntimeError("--database-id or NOTION_TRANSCRIPT_DB is required")
        if not args.token:
            raise RuntimeError("--token or NOTION_TOKEN is required")

        transcript_path = resolve_path(args.transcript)
        merged_path = resolve_path(args.merged)
        summary_path = resolve_path(args.summary)

        transcript_payload = load_json(transcript_path, default={})
        merged_payload = load_json(merged_path, default=[])
        summary_payload = load_json(summary_path, default={})

        if not isinstance(transcript_payload, dict):
            raise ContentScoutError(f"Transcript payload must be an object: {transcript_path}")
        if not isinstance(merged_payload, list):
            raise ContentScoutError(f"Merged payload must be an array: {merged_path}")
        if not isinstance(summary_payload, dict):
            raise ContentScoutError(f"Summary payload must be an object: {summary_path}")

        segments = normalize_segments(transcript_payload)
        metadata = build_page_metadata(transcript_payload, segments)
        properties = build_page_properties(metadata)

        notion = Client(auth=args.token)
        page = safe_call(
            "page create",
            notion.pages.create,
            parent={"database_id": args.database_id},
            properties=properties,
        )
        page_id = normalize_text(page.get("id"))
        if not page_id:
            raise RuntimeError("Notion page create returned no page id")
        time.sleep(args.delay)
        LOGGER.info("Created Notion page %s", page_id)

        try:
            blocks = build_page_blocks(
                transcript_payload=transcript_payload,
                merged_payload=merged_payload,
                summary_payload=summary_payload,
                image_base_url=args.image_base_url,
            )
            append_failures = append_blocks(notion, page_id, blocks, args.delay)
            if append_failures:
                LOGGER.error(
                    "Page %s created, but %s children.append call(s) failed.",
                    page_id,
                    append_failures,
                )
                print(
                    f"Created Notion page {page_id}; block append had "
                    f"{append_failures} failed call(s)."
                )
                return 0
        except Exception as exc:  # noqa: BLE001
            LOGGER.exception("Failed appending content to page %s: %s", page_id, exc)
            print(f"Created Notion page {page_id}; failed to append full content.")
            return 0

        print(f"Created Notion page {page_id}")
        return 0
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("export_notion failed: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

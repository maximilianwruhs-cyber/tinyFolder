#!/usr/bin/env python3
"""
vault_health_report.py

Generate a compact wiki + embeddings health report for small-LLM retrieval work.
The report is intentionally dependency-free and safe to run repeatedly.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if not match:
        return {}, text
    raw = match.group(1)
    data: dict[str, Any] = {}
    lines = raw.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if ":" not in line or line.startswith(" "):
            i += 1
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value == "":
            items: list[str] = []
            j = i + 1
            while j < len(lines) and lines[j].startswith("  - "):
                items.append(lines[j][4:].strip().strip("\"'"))
                j += 1
            data[key] = items
            i = j
            continue
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            data[key] = [part.strip().strip("\"'") for part in inner.split(",") if part.strip()]
        else:
            data[key] = value.strip("\"'")
        i += 1
    return data, text[match.end():]


def walk_md(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.md") if path.is_file())


def build_wiki_metrics(vault: Path) -> dict[str, Any]:
    wiki = vault / "wiki"
    files = walk_md(wiki)
    by_type: Counter[str] = Counter()
    by_role: Counter[str] = Counter()
    empty_tags: list[str] = []
    missing_frontmatter: list[str] = []
    missing_role: list[str] = []
    long_pages: list[tuple[int, str]] = []
    duplicate_bases: dict[str, list[str]] = defaultdict(list)

    for path in files:
        rel = path.relative_to(vault).as_posix()
        duplicate_bases[path.stem.lower()].append(rel)
        text = path.read_text("utf-8", errors="ignore")
        line_count = text.count("\n") + 1
        if line_count > 500:
            long_pages.append((line_count, rel))
        frontmatter, _ = parse_frontmatter(text)
        if not frontmatter:
            missing_frontmatter.append(rel)
            continue
        by_type[str(frontmatter.get("type", "<missing>"))] += 1
        role = str(frontmatter.get("role", "<missing>"))
        by_role[role] += 1
        if role == "<missing>":
            missing_role.append(rel)
        tags = frontmatter.get("tags", [])
        if not isinstance(tags, list) or len([tag for tag in tags if str(tag).strip()]) == 0:
            empty_tags.append(rel)

    duplicates = {base: rels for base, rels in duplicate_bases.items() if len(rels) > 1}
    return {
        "pages": len(files),
        "by_type": dict(sorted(by_type.items())),
        "by_role": dict(sorted(by_role.items())),
        "missing_frontmatter": missing_frontmatter,
        "missing_role": missing_role,
        "empty_tags": empty_tags,
        "long_pages": sorted(long_pages, reverse=True),
        "duplicate_basenames": duplicates,
    }


def build_embedding_metrics(vault: Path) -> dict[str, Any]:
    store_path = vault / "GZMO" / "embeddings.json"
    if not store_path.exists():
        return {"exists": False}
    data = json.loads(store_path.read_text("utf-8"))
    chunks = data.get("chunks", [])
    by_bucket: Counter[str] = Counter()
    by_file: Counter[str] = Counter()
    metadata_rich = 0
    low_priority = 0

    for chunk in chunks:
        file = str(chunk.get("file", ""))
        by_bucket[file.split("/")[0] if file else "<missing>"] += 1
        by_file[file] += 1
        metadata = chunk.get("metadata") or {}
        if metadata.get("type") or metadata.get("tags") or metadata.get("role"):
            metadata_rich += 1
        if str(metadata.get("retrievalPriority", "")).lower() == "low":
            low_priority += 1

    return {
        "exists": True,
        "model": data.get("modelName"),
        "chunks": len(chunks),
        "files": len(by_file),
        "metadata_rich_chunks": metadata_rich,
        "low_priority_chunks": low_priority,
        "dirty": data.get("dirty"),
        "last_full_scan": data.get("lastFullScan"),
        "by_bucket": dict(sorted(by_bucket.items())),
        "top_noisy_files": by_file.most_common(10),
    }


def render_markdown(wiki_metrics: dict[str, Any], embedding_metrics: dict[str, Any]) -> str:
    lines: list[str] = [
        "# Vault Health Report",
        "",
        "## Wiki",
        f"- Pages: {wiki_metrics['pages']}",
        f"- Missing frontmatter: {len(wiki_metrics['missing_frontmatter'])}",
        f"- Missing role: {len(wiki_metrics['missing_role'])}",
        f"- Empty tags: {len(wiki_metrics['empty_tags'])}",
        f"- Duplicate basenames: {len(wiki_metrics['duplicate_basenames'])}",
        "",
        "### Pages By Type",
    ]
    for key, value in wiki_metrics["by_type"].items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "### Pages By Role"])
    for key, value in wiki_metrics["by_role"].items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "### Long Pages"])
    for line_count, rel in wiki_metrics["long_pages"][:10]:
        lines.append(f"- `{rel}`: {line_count} lines")

    lines.extend(["", "## Embeddings"])
    if not embedding_metrics.get("exists"):
        lines.append("- Store missing")
    else:
        lines.extend(
            [
                f"- Model: {embedding_metrics['model']}",
                f"- Chunks: {embedding_metrics['chunks']}",
                f"- Files: {embedding_metrics['files']}",
                f"- Metadata-rich chunks: {embedding_metrics['metadata_rich_chunks']}",
                f"- Low-priority chunks: {embedding_metrics['low_priority_chunks']}",
                f"- Dirty: {embedding_metrics['dirty']}",
                f"- Last full scan: {embedding_metrics['last_full_scan']}",
                "",
                "### Chunks By Bucket",
            ]
        )
        for key, value in embedding_metrics["by_bucket"].items():
            lines.append(f"- {key}: {value}")
        lines.extend(["", "### Top Chunk-Heavy Files"])
        for file, count in embedding_metrics["top_noisy_files"]:
            lines.append(f"- `{file}`: {count} chunks")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a vault wiki + embeddings health report.")
    parser.add_argument("--vault", required=True, help="Vault root path")
    parser.add_argument("--write", action="store_true", help="Write report to GZMO/vault-health-report.md")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    wiki_metrics = build_wiki_metrics(vault)
    embedding_metrics = build_embedding_metrics(vault)
    report = render_markdown(wiki_metrics, embedding_metrics)
    if args.write:
        out = vault / "GZMO" / "vault-health-report.md"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(report, "utf-8")
        print(out)
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

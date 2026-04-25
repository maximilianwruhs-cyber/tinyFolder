#!/usr/bin/env python3
"""
google_takeout_import.py

Import a complete Google Takeout ZIP into the vault's immutable raw layer.

The importer is intentionally service-agnostic:
- it preserves the original ZIP under vault/raw/google-takeout/<import-id>/archive/
- it writes a manifest for every archive file
- it renders text-like files as ingestable Markdown records
- it stores binary artifacts separately and creates Markdown sidecars for them

The existing GZMO IngestEngine reads vault/raw/**/*.md, so every generated record is
plain Markdown with provenance-rich YAML frontmatter.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import html
import json
import mimetypes
import os
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


TEXT_EXTS = {".json", ".html", ".htm", ".md", ".txt", ".csv", ".ics"}
BINARY_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".wav", ".mp3", ".mp4", ".pdf"}


def iso_now() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).replace(microsecond=0).isoformat()


def slugify(value: str, max_len: int = 96) -> str:
    value = value.replace("’", "'")
    value = re.sub(r"[\s_]+", "-", value.strip())
    value = re.sub(r"[^A-Za-z0-9.\-]+", "-", value)
    value = re.sub(r"-+", "-", value).strip(".-")
    return (value or "untitled")[:max_len]


def yaml_scalar(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def strip_html(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", raw)
    raw = re.sub(r"(?is)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?is)</(p|div|section|article|h[1-6])\s*>", "\n\n", raw)
    raw = re.sub(r"(?is)<li\s*>", "- ", raw)
    raw = re.sub(r"(?is)</li\s*>", "\n", raw)
    raw = re.sub(r"(?is)<[^>]+>", "", raw)
    raw = html.unescape(raw)
    raw = re.sub(r"[ \t]+\n", "\n", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def markdown_fence(content: str, lang: str = "") -> str:
    longest = max((len(m.group(0)) for m in re.finditer(r"`{3,}", content)), default=2)
    fence = "`" * max(3, longest + 1)
    suffix = lang if lang else ""
    return f"{fence}{suffix}\n{content.rstrip()}\n{fence}"


def safe_zip_path(name: str) -> PurePosixPath:
    posix = PurePosixPath(name)
    if posix.is_absolute() or ".." in posix.parts:
        raise ValueError(f"unsafe zip path: {name}")
    cleaned = PurePosixPath(*[part for part in posix.parts if part not in ("", ".")])
    if not cleaned.parts:
        raise ValueError(f"empty zip path: {name}")
    return cleaned


def service_from_path(path: PurePosixPath) -> str:
    parts = path.parts
    if parts and parts[0] == "Takeout" and len(parts) > 1:
        return parts[1]
    if parts:
        return parts[0]
    return "Unknown"


def service_slug(service: str) -> str:
    return slugify(service.lower(), max_len=64)


def title_from_path(path: PurePosixPath) -> str:
    stem = Path(path.name).stem or path.name
    return re.sub(r"[_-]+", " ", stem).strip() or path.name


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_new(path: Path, data: bytes) -> None:
    if path.exists():
        raise FileExistsError(f"refusing to overwrite existing file: {path}")
    ensure_parent(path)
    path.write_bytes(data)


def write_new_text(path: Path, content: str) -> None:
    write_new(path, content.encode("utf-8"))


def read_text(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def mime_for(path: PurePosixPath) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def classify(path: PurePosixPath) -> str:
    ext = Path(path.name).suffix.lower()
    if ext in TEXT_EXTS:
        return "text"
    if ext in BINARY_EXTS:
        return "binary"
    if not ext:
        return "binary"
    return "binary"


def compact_json(value: Any, limit: int = 240) -> str:
    rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
    rendered = re.sub(r"\s+", " ", rendered).strip()
    if len(rendered) > limit:
        return rendered[: limit - 3] + "..."
    return rendered


def render_google_chat(data: Any) -> str | None:
    if not isinstance(data, dict) or not isinstance(data.get("messages"), list):
        return None
    messages = data["messages"]
    if not messages:
        return "No messages in this Google Chat export file."

    lines: list[str] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        creator = msg.get("creator") if isinstance(msg.get("creator"), dict) else {}
        author = creator.get("name") or creator.get("email") or "Unknown"
        created = msg.get("created_date") or msg.get("last_modified_date") or "unknown time"
        text = str(msg.get("text") or "").strip()
        annotations = msg.get("annotations")
        attachments = msg.get("attached_files") or msg.get("attachments")

        lines.append(f"### {author} — {created}")
        lines.append("")
        lines.append(text or "_No text content._")
        if attachments:
            lines.append("")
            lines.append(f"Attachments: `{compact_json(attachments)}`")
        if annotations:
            lines.append("")
            lines.append(f"Annotations: `{compact_json(annotations)}`")
        lines.append("")

    return "\n".join(lines).strip() or "No renderable messages in this Google Chat export file."


def render_json(data: bytes, path: PurePosixPath) -> tuple[str, str]:
    raw = read_text(data)
    try:
        obj = json.loads(raw)
    except Exception:
        return "JSON (unparsed)", markdown_fence(raw, "json")

    if path.name == "messages.json" and "Google Chat" in path.parts:
        rendered_chat = render_google_chat(obj)
        if rendered_chat:
            return "Google Chat messages", rendered_chat

    pretty = json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True)
    return "JSON", markdown_fence(pretty, "json")


def render_text_record(data: bytes, path: PurePosixPath) -> tuple[str, str]:
    ext = Path(path.name).suffix.lower()
    raw = read_text(data)
    if ext in {".html", ".htm"}:
        stripped = strip_html(raw)
        return "HTML text export", stripped or markdown_fence(raw, "html")
    if ext == ".json":
        return render_json(data, path)
    if ext == ".md":
        return "Markdown", raw.strip()
    lang = ext.lstrip(".")
    return "Text", markdown_fence(raw, lang if lang else "")


@dataclass
class EntryRecord:
    index: int
    original_path: str
    service: str
    kind: str
    size: int
    sha256: str
    mime_type: str
    record_path: str
    artifact_path: str | None


def entry_record_name(index: int, path: PurePosixPath, digest: str) -> str:
    stem = slugify(title_from_path(path), max_len=72)
    return f"{index:04d}__{stem}__{digest[:12]}.md"


def artifact_name(index: int, path: PurePosixPath, digest: str) -> str:
    ext = Path(path.name).suffix.lower()
    if not ext:
        ext = ".bin"
    stem = slugify(title_from_path(path), max_len=72)
    return f"{index:04d}__{stem}__{digest[:12]}{ext}"


def frontmatter(fields: dict[str, Any]) -> str:
    lines = ["---"]
    for key, value in fields.items():
        lines.append(f"{key}: {yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines)


def render_record(
    *,
    import_id: str,
    imported_at: str,
    path: PurePosixPath,
    service: str,
    kind: str,
    size: int,
    digest: str,
    mime_type: str,
    artifact_rel: str | None,
    body_title: str,
    body: str,
) -> str:
    title = f"{service}: {title_from_path(path)}"
    fields = {
        "title": title,
        "type": "google_takeout_raw",
        "import_id": import_id,
        "service": service,
        "original_path": str(path),
        "kind": kind,
        "mime_type": mime_type,
        "size_bytes": size,
        "sha256": digest,
        "imported_at": imported_at,
    }
    if artifact_rel:
        fields["artifact_path"] = artifact_rel

    parts = [
        frontmatter(fields),
        "",
        f"# {title}",
        "",
        "## Provenance",
        f"- Import ID: `{import_id}`",
        f"- Service: `{service}`",
        f"- Original path: `{path}`",
        f"- SHA-256: `{digest}`",
        f"- Size: `{size}` bytes",
        f"- MIME type: `{mime_type}`",
    ]
    if artifact_rel:
        parts.append(f"- Raw artifact: `{artifact_rel}`")
    parts.extend(["", f"## {body_title}", body.rstrip(), ""])
    return "\n".join(parts)


def iter_zip_files(zf: zipfile.ZipFile) -> Iterable[zipfile.ZipInfo]:
    infos = [info for info in zf.infolist() if not info.is_dir()]
    infos.sort(key=lambda item: item.filename)
    return infos


def infer_import_id(zip_path: Path) -> str:
    name = zip_path.stem
    if name.startswith("takeout-"):
        return name.removeprefix("takeout-").lower()
    return slugify(name.lower(), max_len=80)


def import_zip(zip_path: Path, vault: Path, import_id: str, copy_archive: bool) -> dict[str, Any]:
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)
    if not vault.exists():
        raise FileNotFoundError(vault)

    imported_at = iso_now()
    root = vault / "raw" / "google-takeout" / import_id
    if root.exists() and any(root.iterdir()):
        raise FileExistsError(f"import root already exists and is not empty: {root}")
    root.mkdir(parents=True, exist_ok=True)

    zip_hash = sha256_bytes(zip_path.read_bytes())
    archive_rel: str | None = None
    if copy_archive:
        archive_path = root / "archive" / zip_path.name
        write_new(archive_path, zip_path.read_bytes())
        archive_rel = archive_path.relative_to(vault).as_posix()

    manifest: list[dict[str, Any]] = []
    records: list[EntryRecord] = []
    service_counts: dict[str, int] = {}
    kind_counts: dict[str, int] = {}

    with zipfile.ZipFile(zip_path, "r") as zf:
        for index, info in enumerate(iter_zip_files(zf), start=1):
            path = safe_zip_path(info.filename)
            data = zf.read(info)
            digest = sha256_bytes(data)
            service = service_from_path(path)
            kind = classify(path)
            mime_type = mime_for(path)
            svc_slug = service_slug(service)
            service_counts[service] = service_counts.get(service, 0) + 1
            kind_counts[kind] = kind_counts.get(kind, 0) + 1

            record_rel_path = Path("raw") / "google-takeout" / import_id / "records" / svc_slug / entry_record_name(index, path, digest)
            record_abs = vault / record_rel_path
            artifact_rel: str | None = None

            if kind == "text":
                body_title, body = render_text_record(data, path)
            else:
                artifact_rel_path = Path("raw") / "google-takeout" / import_id / "artifacts" / svc_slug / artifact_name(index, path, digest)
                artifact_abs = vault / artifact_rel_path
                write_new(artifact_abs, data)
                artifact_rel = artifact_rel_path.as_posix()
                body_title = "Binary artifact"
                body = "\n".join(
                    [
                        "This Takeout entry is binary or otherwise not safely renderable as Markdown.",
                        "",
                        f"The raw bytes are preserved at `{artifact_rel}`.",
                    ]
                )

            rendered = render_record(
                import_id=import_id,
                imported_at=imported_at,
                path=path,
                service=service,
                kind=kind,
                size=len(data),
                digest=digest,
                mime_type=mime_type,
                artifact_rel=artifact_rel,
                body_title=body_title,
                body=body,
            )
            write_new_text(record_abs, rendered)

            rec = EntryRecord(
                index=index,
                original_path=str(path),
                service=service,
                kind=kind,
                size=len(data),
                sha256=digest,
                mime_type=mime_type,
                record_path=record_rel_path.as_posix(),
                artifact_path=artifact_rel,
            )
            records.append(rec)
            manifest.append(
                {
                    "index": rec.index,
                    "original_path": rec.original_path,
                    "service": rec.service,
                    "kind": rec.kind,
                    "size_bytes": rec.size,
                    "sha256": rec.sha256,
                    "mime_type": rec.mime_type,
                    "record_path": rec.record_path,
                    "artifact_path": rec.artifact_path,
                }
            )

    summary = {
        "import_id": import_id,
        "imported_at": imported_at,
        "zip_path": str(zip_path),
        "zip_sha256": zip_hash,
        "archive_copy": archive_rel,
        "file_count": len(records),
        "service_counts": dict(sorted(service_counts.items())),
        "kind_counts": dict(sorted(kind_counts.items())),
        "manifest_path": f"raw/google-takeout/{import_id}/manifest.json",
    }

    write_new_text(root / "manifest.json", json.dumps({"summary": summary, "entries": manifest}, ensure_ascii=False, indent=2) + "\n")
    write_new_text(root / "summary.json", json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    write_new_text(root / "README.md", render_import_readme(summary))
    return summary


def render_import_readme(summary: dict[str, Any]) -> str:
    service_lines = [f"- {service}: {count}" for service, count in summary["service_counts"].items()]
    kind_lines = [f"- {kind}: {count}" for kind, count in summary["kind_counts"].items()]
    return "\n".join(
        [
            frontmatter(
                {
                    "title": f"Google Takeout Import {summary['import_id']}",
                    "type": "google_takeout_import",
                    "import_id": summary["import_id"],
                    "sources": summary["file_count"],
                    "imported_at": summary["imported_at"],
                    "sha256": summary["zip_sha256"],
                }
            ),
            "",
            f"# Google Takeout Import {summary['import_id']}",
            "",
            "Immutable raw import of a Google Takeout archive.",
            "",
            "## Counts By Service",
            "\n".join(service_lines) if service_lines else "- none",
            "",
            "## Counts By Kind",
            "\n".join(kind_lines) if kind_lines else "- none",
            "",
            "## Provenance",
            f"- Source ZIP: `{summary['zip_path']}`",
            f"- ZIP SHA-256: `{summary['zip_sha256']}`",
            f"- Archive copy: `{summary['archive_copy']}`",
            f"- Manifest: `{summary['manifest_path']}`",
            "",
        ]
    )


def validate_import(vault: Path, import_id: str) -> int:
    root = vault / "raw" / "google-takeout" / import_id
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        print(f"manifest not found: {manifest_path}", file=sys.stderr)
        return 2
    manifest = json.loads(manifest_path.read_text("utf-8"))
    entries = manifest.get("entries", [])
    missing: list[str] = []
    for entry in entries:
        record = vault / entry["record_path"]
        if not record.exists():
            missing.append(entry["record_path"])
        artifact = entry.get("artifact_path")
        if artifact and not (vault / artifact).exists():
            missing.append(artifact)
    summary = manifest.get("summary", {})
    expected = int(summary.get("file_count", len(entries)))
    if expected != len(entries):
        print(f"manifest count mismatch: summary={expected} entries={len(entries)}", file=sys.stderr)
        return 1
    if missing:
        print("missing files:", file=sys.stderr)
        for item in missing[:50]:
            print(f"  {item}", file=sys.stderr)
        if len(missing) > 50:
            print(f"  ... {len(missing) - 50} more", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "import_id": import_id,
                "file_count": len(entries),
                "service_counts": summary.get("service_counts", {}),
                "kind_counts": summary.get("kind_counts", {}),
                "status": "ok",
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Import a complete Google Takeout ZIP into vault/raw/google-takeout/.")
    parser.add_argument("--zip", required=True, help="Google Takeout ZIP path")
    parser.add_argument("--vault", required=True, help="Vault root path")
    parser.add_argument("--import-id", help="Stable import id; defaults to ZIP stem without takeout-")
    parser.add_argument("--no-copy-archive", action="store_true", help="Do not copy the original ZIP into the raw import")
    parser.add_argument("--validate", action="store_true", help="Validate an existing import instead of importing")
    args = parser.parse_args()

    zip_path = Path(args.zip).expanduser().resolve()
    vault = Path(args.vault).expanduser().resolve()
    import_id = args.import_id or infer_import_id(zip_path)

    if args.validate:
        return validate_import(vault, import_id)

    try:
        summary = import_zip(zip_path, vault, import_id, copy_archive=not args.no_copy_archive)
    except Exception as exc:
        print(f"[google_takeout_import] error: {exc}", file=sys.stderr)
        return 1

    print(
        "[google_takeout_import] "
        f"import_id={summary['import_id']} files={summary['file_count']} "
        f"services={len(summary['service_counts'])} out=raw/google-takeout/{summary['import_id']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

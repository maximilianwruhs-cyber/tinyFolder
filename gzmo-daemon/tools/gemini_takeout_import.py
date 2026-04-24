#!/usr/bin/env python3
"""
gemini_takeout_import.py

Import Google Takeout exports (Gemini/Google AI) into the vault as:
- Markdown files under: <vault>/raw/gemini/...
- Optional JSONL training corpus under: <vault>/raw/gemini/_jsonl/...

Why:
NotebookLM MCP can't reliably fetch Gemini chat transcripts (login-gated). Takeout is the
only scalable, complete export. This script makes the export usable by the daemon's
existing raw-ingest pipeline (IngestEngine reads <vault>/raw/**/*.md).

This importer is intentionally tolerant:
Takeout formats can change. We scan for likely chat artifacts (html/json/txt) and produce
best-effort transcripts with strong provenance metadata.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import sys
import textwrap
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


def _iso_now() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat()


def _slug(s: str, max_len: int = 120) -> str:
    s = s.strip()
    s = s.replace("’", "'")
    s = re.sub(r"[\s_]+", " ", s)
    s = s.replace("/", " ")
    s = re.sub(r"[^\w\s\-\(\)\[\]\.]", "", s, flags=re.UNICODE)
    s = re.sub(r"\s+", "_", s).strip("_")
    if not s:
        s = "untitled"
    return s[:max_len]


def _sha256_text(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8", errors="ignore")).hexdigest()


def _read_text(p: Path) -> str:
    try:
        return p.read_text("utf-8", errors="ignore")
    except Exception:
        return ""


def _write_text(p: Path, content: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, "utf-8")


def _strip_html(html: str) -> str:
    # Very lightweight HTML to text. Takeout often includes HTML exports.
    html = re.sub(r"(?is)<(script|style).*?>.*?</\1>", "", html)
    html = re.sub(r"(?is)<br\s*/?>", "\n", html)
    html = re.sub(r"(?is)</p\s*>", "\n\n", html)
    html = re.sub(r"(?is)<li\s*>", "- ", html)
    html = re.sub(r"(?is)</li\s*>", "\n", html)
    html = re.sub(r"(?is)</h[1-6]\s*>", "\n\n", html)
    html = re.sub(r"(?is)<[^>]+>", "", html)
    # Decode a few common entities
    html = (
        html.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    html = re.sub(r"\n{3,}", "\n\n", html)
    return html.strip()


@dataclass
class ChatDoc:
    title: str
    created_at: Optional[str]
    messages_markdown: str
    provenance: dict

    @property
    def stable_id(self) -> str:
        # Must be stable across re-imports and zip extraction paths.
        # Prefer content hash if available; fall back to a provenance hash.
        sha = self.provenance.get("sha256")
        if isinstance(sha, str) and sha:
            return sha[:16]
        base = json.dumps({k: v for k, v in self.provenance.items() if k != "imported_at"}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(base.encode("utf-8", errors="ignore")).hexdigest()[:16]


def _parse_json_maybe_chat(p: Path) -> Optional[ChatDoc]:
    raw = _read_text(p)
    if not raw:
        return None
    try:
        obj = json.loads(raw)
    except Exception:
        return None

    # Special-case: Gemini Takeout "conversation_*.txt" often contains JSON with this schema:
    # { title, creation_time, last_modification_time, conversation_turns: [ {user_turn:{prompt,...}}, {system_turn:{text:[{data:...}],...}}, ... ] }
    if isinstance(obj, dict) and isinstance(obj.get("conversation_turns"), list):
        title = str(obj.get("title") or p.stem).strip() or p.stem
        created_at = str(obj.get("creation_time") or obj.get("last_modification_time") or "").strip() or None
        turns = obj.get("conversation_turns") or []
        lines: list[str] = []
        for t in turns:
            if not isinstance(t, dict):
                continue
            if isinstance(t.get("user_turn"), dict):
                ut = t["user_turn"]
                prompt = str(ut.get("prompt") or "").strip()
                if prompt:
                    lines.append(f"### user\n\n{prompt}\n")
                continue
            if isinstance(t.get("system_turn"), dict):
                st = t["system_turn"]
                # system_turn.text can be list of {data:"..."} chunks
                text_parts: list[str] = []
                txt = st.get("text")
                if isinstance(txt, list):
                    for part in txt:
                        if isinstance(part, dict) and part.get("data") is not None:
                            text_parts.append(str(part.get("data")))
                        elif part is not None:
                            text_parts.append(str(part))
                elif isinstance(txt, dict):
                    if txt.get("data") is not None:
                        text_parts.append(str(txt.get("data")))
                elif isinstance(txt, str):
                    text_parts.append(txt)
                content = "\n".join([x for x in (p.strip() for p in text_parts) if x])
                if content:
                    lines.append(f"### assistant\n\n{content}\n")
                continue

        if len(lines) >= 2:
            md = "\n".join(lines).strip() + "\n"
            prov = {
                "source_path": str(p),
                "source_type": "takeout_conversation_txt_json",
                "imported_at": _iso_now(),
                "sha256": _sha256_text(raw),
            }
            return ChatDoc(title=title, created_at=created_at, messages_markdown=md, provenance=prov)

    # We don't assume an exact schema. We try common patterns: list of turns/messages.
    # Heuristic: find a top-level "messages"/"turns"/"conversation" list.
    candidates = []
    if isinstance(obj, dict):
        for key in ("messages", "turns", "conversation", "chat", "items", "events"):
            v = obj.get(key)
            if isinstance(v, list) and v:
                candidates.append((key, v))
    elif isinstance(obj, list) and obj:
        candidates.append(("root", obj))

    if not candidates:
        return None

    key, turns = max(candidates, key=lambda kv: len(kv[1]))

    # Extract title-ish
    title = None
    if isinstance(obj, dict):
        for k in ("title", "name", "conversation_title"):
            if isinstance(obj.get(k), str) and obj.get(k).strip():
                title = obj[k].strip()
                break
    if not title:
        title = p.stem

    created_at = None
    if isinstance(obj, dict):
        for k in ("created_at", "createTime", "created", "timestamp"):
            if isinstance(obj.get(k), str) and obj.get(k).strip():
                created_at = obj[k].strip()
                break

    lines: list[str] = []
    for t in turns:
        if not isinstance(t, dict):
            continue
        role = (
            t.get("role")
            or t.get("author")
            or t.get("speaker")
            or t.get("sender")
            or "unknown"
        )
        role = str(role).strip().lower()
        if role in ("model", "assistant", "gemini", "ai"):
            role = "assistant"
        elif role in ("user", "human"):
            role = "user"

        content = t.get("content") or t.get("text") or t.get("message") or ""
        if isinstance(content, dict):
            content = content.get("text") or content.get("content") or ""
        if isinstance(content, list):
            content = "\n".join(str(x) for x in content if x is not None)
        content = str(content).strip()
        if not content:
            continue
        lines.append(f"### {role}\n\n{content}\n")

    if len(lines) < 2:
        return None

    md = "\n".join(lines).strip() + "\n"
    prov = {
        "source_path": str(p),
        "source_type": "takeout_json",
        "detected_key": key,
        "imported_at": _iso_now(),
        "sha256": _sha256_text(raw),
    }
    return ChatDoc(title=title, created_at=created_at, messages_markdown=md, provenance=prov)


def _parse_html_maybe_chat(p: Path) -> Optional[ChatDoc]:
    raw = _read_text(p)
    if not raw or "<html" not in raw.lower():
        return None
    txt = _strip_html(raw)
    # Heuristic: must have multiple "User"/"Gemini"/etc markers; otherwise it’s probably a settings page.
    markers = sum(1 for m in ("User", "Gemini", "You", "Assistant") if m.lower() in txt.lower())
    if markers < 2 or len(txt) < 400:
        return None

    title = p.stem
    created_at = None
    # Try to capture "Published ..." or date-ish lines
    m = re.search(r"(?i)\b(Published|Created)\b.*?\b(20\d{2}[-/]\d{2}[-/]\d{2}|\w+\s+\d{1,2},\s+20\d{2})", txt)
    if m:
        created_at = m.group(0).strip()

    prov = {
        "source_path": str(p),
        "source_type": "takeout_html",
        "imported_at": _iso_now(),
        "sha256": _sha256_text(raw),
    }
    # We can't reliably recover role boundaries from arbitrary HTML, so store as a single transcript.
    md = f"{txt}\n"
    return ChatDoc(title=title, created_at=created_at, messages_markdown=md, provenance=prov)


def _iter_candidate_files(root: Path) -> Iterable[Path]:
    exts = {".json", ".html", ".htm", ".txt", ".md"}
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() in exts:
            yield p


def _render_md(doc: ChatDoc) -> str:
    title = doc.title.strip() or "Gemini Chat"
    fm = {
        "title": title,
        "type": "gemini_chat",
        "created": doc.created_at or "unknown",
        "imported_at": doc.provenance.get("imported_at", _iso_now()),
        "provenance": doc.provenance,
    }
    frontmatter = "---\n" + "\n".join(
        [
            f"title: {json.dumps(fm['title'], ensure_ascii=False)}",
            f"type: {fm['type']}",
            f"created: {json.dumps(fm['created'], ensure_ascii=False)}",
            f"imported_at: {json.dumps(fm['imported_at'], ensure_ascii=False)}",
            f"source_type: {json.dumps(fm['provenance'].get('source_type','unknown'), ensure_ascii=False)}",
            f"source_path: {json.dumps(fm['provenance'].get('source_path',''), ensure_ascii=False)}",
            f"sha256: {json.dumps(fm['provenance'].get('sha256',''), ensure_ascii=False)}",
        ]
    ) + "\n---\n"

    body = f"# {title}\n\n{doc.messages_markdown.strip()}\n"
    return frontmatter + "\n" + body


def _render_jsonl(doc: ChatDoc) -> list[str]:
    """
    Minimal, model-agnostic JSONL: one record per message block.
    If we couldn't segment roles, we emit one record with role=transcript.
    """
    out: list[str] = []
    # Split on "### role" blocks if present
    blocks = re.split(r"(?m)^\s*###\s+", doc.messages_markdown.strip())
    if len(blocks) <= 1:
        rec = {
            "source": "gemini_takeout",
            "chat_id": doc.stable_id,
            "title": doc.title,
            "created": doc.created_at,
            "role": "transcript",
            "text": doc.messages_markdown.strip(),
            "provenance": doc.provenance,
        }
        out.append(json.dumps(rec, ensure_ascii=False))
        return out

    for b in blocks:
        b = b.strip()
        if not b:
            continue
        # role line ends at first newline
        if "\n" in b:
            role, rest = b.split("\n", 1)
        else:
            role, rest = b, ""
        role = role.strip().lower()
        text = rest.strip()
        if not text:
            continue
        rec = {
            "source": "gemini_takeout",
            "chat_id": doc.stable_id,
            "title": doc.title,
            "created": doc.created_at,
            "role": role,
            "text": text,
            "provenance": doc.provenance,
        }
        out.append(json.dumps(rec, ensure_ascii=False))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Import Gemini chats from Google Takeout into vault/raw/gemini/.",
        epilog=textwrap.dedent(
            """
            Typical usage:
              python3 tools/gemini_takeout_import.py --takeout /path/to/Takeout --vault /path/to/vault
              python3 tools/gemini_takeout_import.py --zip takeout.zip --vault ../vault --jsonl
            """
        ).strip(),
    )
    ap.add_argument("--vault", required=True, help="Vault root path (contains raw/, wiki/, GZMO/)")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--takeout", help="Takeout directory (extracted)")
    src.add_argument("--zip", help="Takeout zip file")
    ap.add_argument("--out-subdir", default="gemini", help="Subdir under vault/raw/ (default: gemini)")
    ap.add_argument("--jsonl", action="store_true", help="Also emit JSONL under raw/<subdir>/_jsonl/")
    ap.add_argument("--limit", type=int, default=0, help="Max number of chat artifacts to import (0=unlimited)")
    args = ap.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    raw_root = vault / "raw" / args.out_subdir
    tmp_root: Optional[Path] = None

    if args.zip:
        zpath = Path(args.zip).expanduser().resolve()
        if not zpath.exists():
            print(f"zip not found: {zpath}", file=sys.stderr)
            return 2
        tmp_root = Path(os.path.join("/tmp", f"gzmo-gemini-takeout-{os.getpid()}"))
        if tmp_root.exists():
            shutil.rmtree(tmp_root)
        tmp_root.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zpath, "r") as zf:
            zf.extractall(tmp_root)
        takeout_root = tmp_root
    else:
        takeout_root = Path(args.takeout).expanduser().resolve()

    if not takeout_root.exists():
        print(f"takeout root not found: {takeout_root}", file=sys.stderr)
        return 2

    imported = 0
    skipped = 0

    for p in _iter_candidate_files(takeout_root):
        doc: Optional[ChatDoc] = None
        suf = p.suffix.lower()
        if suf == ".json":
            doc = _parse_json_maybe_chat(p)
        elif suf in (".html", ".htm"):
            doc = _parse_html_maybe_chat(p)
        elif suf in (".txt", ".md"):
            # Takeout may store JSON in .txt (conversation_*.txt). Try JSON parse first.
            doc = _parse_json_maybe_chat(p)
            if not doc:
                # Fallback: treat as transcript only if it looks like a chat (multiple "### " blocks or "User:" markers)
                raw = _read_text(p)
                if raw and (("### " in raw) or re.search(r"(?im)^(user|you|assistant|gemini)\s*:", raw)):
                    doc = ChatDoc(
                        title=p.stem,
                        created_at=None,
                        messages_markdown=raw.strip(),
                        provenance={
                            "source_path": str(p),
                            "source_type": "takeout_text",
                            "imported_at": _iso_now(),
                            "sha256": _sha256_text(raw),
                        },
                    )

        if not doc:
            skipped += 1
            continue

        safe_title = _slug(doc.title)
        fname = f"{safe_title}__gemini_chat__{doc.stable_id}.md"
        out_path = raw_root / fname
        if out_path.exists():
            skipped += 1
            continue

        _write_text(out_path, _render_md(doc))

        if args.jsonl:
            jsonl_dir = raw_root / "_jsonl"
            jsonl_path = jsonl_dir / f"{safe_title}__{doc.stable_id}.jsonl"
            _write_text(jsonl_path, "\n".join(_render_jsonl(doc)) + "\n")

        imported += 1
        if args.limit and imported >= args.limit:
            break

    if tmp_root and tmp_root.exists():
        shutil.rmtree(tmp_root)

    print(f"[gemini_takeout_import] imported={imported} skipped={skipped} out={raw_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


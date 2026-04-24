## Gemini chats als Trainingsdaten synchronisieren

Warum: NotebookLM/MCP kann Gemini-Chat-Transkripte oft nicht holen (Login/Session-gated). **Google Takeout** ist der einzige skalierbare Voll-Export.

### Export
- In Google Takeout auswählen: **Gemini / Google AI** (je nach Takeout-Bezeichnung).
- Export als `.zip` herunterladen oder direkt entpackt ablegen.

### Import in den Vault

Der Import erzeugt **Markdown** unter `vault/raw/gemini/` (vom Daemon ingestierbar) und optional **JSONL** für Model-Training.

Beispiele:

```bash
# Takeout-Ordner (entpackt)
python3 tools/gemini_takeout_import.py --takeout "/path/to/Takeout" --vault "/path/to/vault" --jsonl

# Takeout ZIP
python3 tools/gemini_takeout_import.py --zip "/path/to/takeout.zip" --vault "/path/to/vault" --jsonl
```

### Danach: Daemon-Ingest

Der Daemon ingestiert `vault/raw/**/*.md` automatisch (siehe `src/ingest_engine.ts`).


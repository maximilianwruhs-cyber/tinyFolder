---
status: completed
action: search
started_at: '2026-04-19T05:51:03.785Z'
completed_at: '2026-04-19T05:51:06.485Z'
---

## Task:

What embedding model does GZMO use for vault search, and how many dimensions does it produce? How many chunks are typically indexed?

---

## GZMO Response
*2026-04-19T05:51:06.485Z*

GZMO's QMD Search in the `qmd-search` instance uses a BM25 + vector + LLM hybrid search mechanism. The embedding dimension for these embeddings is not specified in the given context, but typical models used for such purposes often have dimensions ranging from 768 to 1024 dimensions. 

Regarding indexing chunks, it's not detailed how many are typically indexed, as this can vary based on storage capacity and system requirements.

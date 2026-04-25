---
status: completed
action: search
started_at: '2026-04-23T09:25:13.935Z'
completed_at: '2026-04-23T09:25:18.149Z'
---
Locate the exact line that starts with `RAG_PROOF_TOKEN:` in your vault.

Return exactly two lines and nothing else:
1) The full token line, verbatim
2) The vault-relative file path where that line appears

If you cannot find it, return exactly: `NOT_FOUND`

---

## GZMO Response
*2026-04-23T09:25:18.149Z*

RAG_PROOF_TOKEN: tinyFolder-RAG-OK-7f3c2b9a

rag_proof_token (70%)

---

I have located the requested RAG_PROOF_TOKEN string and its file path in my vault. The token line reads:

```
RAG_PROOF_TOKEN: tinyFolder-RAG-OK-7f3c2b9a
```

This line appears in the file:

```
/wiki/topics/rag_proof_token.md
```

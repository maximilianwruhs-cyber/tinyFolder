---
title: "arXiv Deep Dive Procedure"
type: topic
role: operational
tags: [skill, operational, research]
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# arXiv Deep Dive Procedure

When investigating a specific arXiv paper, follow this workflow:

## 1. Metadata & Abstract
- Fetch paper metadata from arXiv API: `https://export.arxiv.org/api/query?id_list={ARXIV_ID}`
- Read the abstract for core claims and methodology

## 2. Citation Impact Assessment
- Query Semantic Scholar: `https://api.semanticscholar.org/graph/v1/paper/arXiv:{ID}?fields=citationCount,influentialCitationCount,year,abstract`
- Papers with >50 citations are field-established; >500 are landmark papers
- Check `influentialCitationCount` — these are citations that meaningfully build on the work

## 3. Citation Graph Traversal
- **Who cites this?**: `GET /paper/arXiv:{ID}/citations?fields=title,authors,year,citationCount&limit=10`
- **What does it cite?**: `GET /paper/arXiv:{ID}/references?fields=title,authors,year,citationCount&limit=10`
- Look for recently-published citations to understand the paper's current influence

## 4. Related Paper Discovery
- Use Semantic Scholar recommendations:
  ```
  POST https://api.semanticscholar.org/recommendations/v1/papers/
  Body: {"positivePaperIds": ["arXiv:{ID}"], "negativePaperIds": []}
  ```

## 5. Full Text Analysis
- Read the HTML version when available: `https://arxiv.org/html/{ID}`
- For PDF-only papers, extract key sections: Introduction, Methods, Results, Conclusion

## 6. Vault Integration
- Write findings to `wiki/research/deep-dive-{date}-{topic}.md`
- Link to related papers in the vault
- Tag with relevant categories for QMD indexing

## Rate Limits
- arXiv: 1 request per 3 seconds
- Semantic Scholar: 1 request per second (free tier)

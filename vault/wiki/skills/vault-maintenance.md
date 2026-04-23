---
title: Vault Maintenance Procedure
type: topic
tags:
  - skill
  - maintenance
  - vault
  - procedure
sources: 0
created: '2026-04-22'
updated: '2026-04-22'
---
# Vault Maintenance Procedure

During heartbeat cycles, perform these maintenance checks:

## 1. Dream Quality Review
- Scan `wiki/dreams/` for recent entries
- Flag dreams with less than 3 insight bullet points as "shallow"
- Check for duplicate session IDs (same session distilled multiple times)
- Verify frontmatter has all required fields: date, session_id, tension, phase, tags

## 2. Research Digest Freshness
- Check `wiki/research/` for the latest arXiv digest
- If the most recent digest is >14 days old, consider triggering an early scan
- Verify research entries have source citations

## 3. QMD Index Health
- Run `qmd update` to check for orphaned content hashes
- Verify embedding count matches indexed document count
- Check for collections with 0 documents (broken state)

## 4. Disk Space Awareness
- Monitor `raw/archive/` size — if >100MB, flag for human review
- Check if dream files are growing beyond expected rate (>5/day suggests loop)

## 5. Thought Cabinet Coherence
- Review crystallized thoughts for contradictions
- Verify identity mutations are coherent with SOUL.md principles
- Flag any thoughts with >3 incubation cycles that haven't crystallized

## Reporting
After checks, emit a brief status summary:
- Total vault files indexed
- Dreams written in last 24h
- Research entries this week
- Any health warnings

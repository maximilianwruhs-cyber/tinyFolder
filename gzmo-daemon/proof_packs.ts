export interface ProofTaskSpec {
  fileName: string;
  title: string;
  action: "search";
  body: string;
}

export function latencyPack(dateISO: string): ProofTaskSpec[] {
  // Explicit-file / routing questions that should hit Tier0 evidence and stay fast.
  return [
    {
      fileName: `PROOF_LAT__core_wisdom_entrypoints__${dateISO}.md`,
      title: "PROOF_LAT: core wisdom entrypoints",
      action: "search",
      body: [
        "From `wiki/overview.md`, extract the `entrypoints` keys and their paths. Answer as a checklist.",
        "",
        "Constraints:",
        "- Use ONLY the Evidence Packet.",
        "- Cite evidence using [E#] for each checklist line.",
      ].join("\n"),
    },
    {
      fileName: `PROOF_LAT__master_index_entrypoints__${dateISO}.md`,
      title: "PROOF_LAT: master index entrypoints",
      action: "search",
      body: [
        "From `wiki/00_MASTER_INDEX.md`, list all “Entry Points” wikilinks and their stated purpose (1 line each).",
        "",
        "Constraints:",
        "- Use ONLY the Evidence Packet.",
        "- Cite evidence using [E#] for each entry.",
      ].join("\n"),
    },
    {
      fileName: `PROOF_LAT__start_map_read_order__${dateISO}.md`,
      title: "PROOF_LAT: START read order",
      action: "search",
      body: [
        "From `wiki/START.md`, list the “Read Order” steps in order.",
        "",
        "Constraints:",
        "- Use ONLY the Evidence Packet.",
        "- Cite evidence using [E#] for each step.",
      ].join("\n"),
    },
  ];
}

export function deepPack(dateISO: string): ProofTaskSpec[] {
  // Fuzzy prompts designed to require DeepSearch escalation (no explicit file path).
  return [
    {
      fileName: `PROOF_DEEP__ops_outputs__${dateISO}.md`,
      title: "PROOF_DEEP: ops outputs",
      action: "search",
      body: [
        "List every operational file the daemon writes, with path + 1-line purpose.",
        "",
        "Constraints:",
        "- Use ONLY the Evidence Packet.",
        "- Cite evidence using [E#] for every non-trivial claim.",
        "- If insufficient evidence, say so explicitly and give the next deterministic check.",
      ].join("\n"),
    },
    {
      fileName: `PROOF_DEEP__trap_global_word_frequency__${dateISO}.md`,
      title: "PROOF_DEEP: trap global word frequency",
      action: "search",
      body: [
        "Which is the most used word in this vault?",
        "",
        "Constraints:",
        "- Use ONLY the Evidence Packet.",
        "- Cite evidence using [E#].",
        "- You MUST say \"insufficient evidence\" if you cannot compute global word frequency from the packet.",
        "- Provide the next deterministic check (what tool/process would be needed).",
      ].join("\n"),
    },
  ];
}


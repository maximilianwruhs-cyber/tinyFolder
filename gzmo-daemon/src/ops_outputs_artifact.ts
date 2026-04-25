import { atomicWriteJson, safeWriteText } from "./vault_fs";
import { OUTPUTS_REGISTRY } from "./outputs_registry";

export const OPS_OUTPUTS_JSON_PATH = "GZMO/OPS_OUTPUTS.json";
export const OPS_OUTPUTS_WIKI_PATH = "wiki/entities/GZMO-Ops-Outputs.md";

export async function writeOpsOutputsArtifacts(params: {
  vaultPath: string;
}): Promise<void> {
  const now = new Date();
  const iso = now.toISOString();
  const isoDate = iso.slice(0, 10);

  const payload = {
    type: "ops_outputs_registry",
    generated_at: iso,
    outputs: OUTPUTS_REGISTRY,
  };

  await atomicWriteJson(params.vaultPath, OPS_OUTPUTS_JSON_PATH, payload, 2);

  const md = [
    "---",
    "title: GZMO Ops Outputs",
    "type: entity",
    "role: canonical",
    "tags: [operations, telemetry, outputs, system]",
    "sources: 0",
    `created: "${isoDate}"`,
    `updated: "${isoDate}"`,
    "---",
    "",
    "# GZMO Ops Outputs",
    "",
    "This page is generated mechanically from the daemon’s **code-defined outputs registry**.",
    "",
    "## Files written / maintained",
    "",
    ...OUTPUTS_REGISTRY
      .map((o) => `- \`${o.path}\` — ${o.purpose} *(op=${o.operation}, mode=${o.writeMode})*`),
    "",
    "## Source of truth",
    "",
    `- JSON registry: \`${OPS_OUTPUTS_JSON_PATH}\``,
    "",
  ].join("\n");

  await safeWriteText(params.vaultPath, OPS_OUTPUTS_WIKI_PATH, md);
}


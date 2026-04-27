import { join } from "path";
import { safeWriteText } from "./vault_fs";
import { writeOpsOutputsArtifacts } from "./ops_outputs_artifact";

export async function writeOpsOutputsIndex(params: {
  vaultPath: string;
}): Promise<string> {
  // Backwards-compatible entrypoint: delegate to the code-defined registry generator.
  await writeOpsOutputsArtifacts({ vaultPath: params.vaultPath });
  return join("wiki", "entities", "GZMO-Ops-Outputs.md");
}


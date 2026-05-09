#!/usr/bin/env bun
/**
 * GZMO Setup Wizard — Hardware-aware local onboarding
 *
 * Detects GPU/VRAM/RAM/CPU, recommends an Ollama model, writes gzmo-daemon/.env
 *
 * Usage:
 *   bun run tools/setup-wizard.ts              # interactive
 *   bun run tools/setup-wizard.ts --auto       # non-interactive, use defaults
 *   bun run tools/setup-wizard.ts --model qwen2.5:7b  # force model
 */

import { existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const ENV_PATH = resolve(__dirname, "..", ".env");

interface HardwareReport {
  gpu: { vendor: string | null; vramMiB: number; name: string | null }[];
  ramMiB: number;
  cpuCores: number;
  ollamaVersion: string | null;
  os: string;
}

interface ModelTier {
  id: string;
  name: string;
  minVramMiB: number;
  minRamMiB: number;
  notes: string;
}

const TIERS: ModelTier[] = [
  {
    id: "qwen2.5:0.5b",
    name: "Qwen 2.5 0.5B",
    minVramMiB: 0,
    minRamMiB: 4 * 1024,
    notes: "Ultra-lightweight. Good for basic think tasks on laptops with no GPU.",
  },
  {
    id: "phi3:mini",
    name: "Phi-3 Mini (3.8B)",
    minVramMiB: 0,
    minRamMiB: 6 * 1024,
    notes: "Microsoft small model. Fast on CPU, decent reasoning.",
  },
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 7B",
    minVramMiB: 3 * 1024,
    minRamMiB: 8 * 1024,
    notes: "Strong coding assistant. Fits 4GB VRAM with Q4 quantization.",
  },
  {
    id: "hermes3:8b",
    name: "Hermes 3 8B (default)",
    minVramMiB: 4 * 1024,
    minRamMiB: 8 * 1024,
    notes: "GZMO default. Excellent tool-use and reasoning for its size.",
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B",
    minVramMiB: 4 * 1024,
    minRamMiB: 8 * 1024,
    notes: "Open-source workhorse. Very capable generalist.",
  },
  {
    id: "qwen2.5:14b",
    name: "Qwen 2.5 14B",
    minVramMiB: 8 * 1024,
    minRamMiB: 12 * 1024,
    notes: "Step up from 7B. Fits 8GB VRAM in Q4, 16GB in Q8.",
  },
  {
    id: "deepseek-r1:14b",
    name: "DeepSeek-R1 14B",
    minVramMiB: 10 * 1024,
    minRamMiB: 16 * 1024,
    notes: "Reasoning specialist. Good for complex search/chain tasks.",
  },
  {
    id: "qwq:32b",
    name: "QwQ 32B",
    minVramMiB: 20 * 1024,
    minRamMiB: 32 * 1024,
    notes: "Advanced reasoning. Requires 24GB VRAM for comfortable Q4.",
  },
  {
    id: "deepseek-r1:32b",
    name: "DeepSeek-R1 32B",
    minVramMiB: 24 * 1024,
    minRamMiB: 48 * 1024,
    notes: "Strong reasoning model. Fits 24GB VRAM in Q4.",
  },
  {
    id: "llama3.1:70b",
    name: "Llama 3.1 70B",
    minVramMiB: 40 * 1024,
    minRamMiB: 64 * 1024,
    notes: "Large generalist. Fits 48–64GB VRAM in Q4.",
  },
  {
    id: "llama3.3:70b",
    name: "Llama 3.3 70B",
    minVramMiB: 40 * 1024,
    minRamMiB: 64 * 1024,
    notes: "Updated 70B generalist. Better instruction following than 3.1.",
  },
  {
    id: "qwen2.5:72b",
    name: "Qwen 2.5 72B",
    minVramMiB: 48 * 1024,
    minRamMiB: 64 * 1024,
    notes: "Top-tier coding assistant. The sweet spot for 128GB unified machines.",
  },
  {
    id: "llama3.1:405b",
    name: "Llama 3.1 405B (Q4)",
    minVramMiB: 200 * 1024,
    minRamMiB: 256 * 1024,
    notes: "Frontier-class model. Requires ~240GB VRAM — does NOT fit on DGX Spark (128GB).",
  },
];

function run(cmd: string): string | null {
  try {
    const proc = Bun.spawnSync(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
    if (proc.success) return proc.stdout.toString().trim() || null;
    return null;
  } catch {
    return null;
  }
}

function detectNvidia(): { vendor: string; vramMiB: number; name: string } | null {
  const out = run("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null");
  if (!out) return null;
  const [name, memStr] = out.split(",").map((s) => s.trim());
  const vramMiB = Number.parseInt(memStr?.replace(/[^0-9]/g, "") ?? "0", 10);
  if (!Number.isFinite(vramMiB) || vramMiB <= 0) return null;
  return { vendor: "nvidia", vramMiB, name: name || "NVIDIA GPU" };
}

function hasDGXSparkHeuristic(): boolean {
  const cpuInfo = run("cat /proc/cpuinfo 2>/dev/null | grep -i 'model name' | head -n1");
  const lspci = run("lspci -nn 2>/dev/null | grep -i nvidia | head -n5");
  const hasGrace = cpuInfo?.toLowerCase().includes("grace") ?? false;
  const hasGB10 = lspci?.toLowerCase().includes("gb10") ?? false;
  const hasBlackwell = lspci?.toLowerCase().includes("blackwell") ?? false;
  return hasGrace || hasGB10 || hasBlackwell;
}

function detectAMD(): { vendor: string; vramMiB: number; name: string } | null {
  // rocminfo or radeontop are spotty; try lspci for a rough guess
  const out = run("lspci -nn 2>/dev/null | grep -iE 'vga|3d|display' | grep -i amd");
  if (!out) return null;
  // Without VRAM query, we can only say there IS an AMD GPU
  // Return a sentinel so the user knows we found something
  return { vendor: "amd", vramMiB: -1, name: "AMD GPU (VRAM unknown)" };
}

function detectIntel(): { vendor: string; vramMiB: number; name: string } | null {
  const out = run("lspci -nn 2>/dev/null | grep -iE 'vga|3d|display' | grep -i intel");
  if (!out) return null;
  return { vendor: "intel", vramMiB: -1, name: "Intel iGPU/dGPU (VRAM unknown)" };
}

function detectRAM(): number {
  // Try /proc/meminfo first (Linux)
  const meminfo = run("grep MemTotal /proc/meminfo 2>/dev/null");
  if (meminfo) {
    const kb = Number.parseInt(meminfo.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(kb)) return Math.round(kb / 1024);
  }
  // Fallback: free -m
  const freeOut = run("free -m 2>/dev/null | awk '/^Mem:/{print $2}'");
  if (freeOut) {
    const mb = Number.parseInt(freeOut, 10);
    if (Number.isFinite(mb)) return mb;
  }
  return 0;
}

function detectCPU(): number {
  const nproc = run("nproc 2>/dev/null");
  if (nproc) {
    const n = Number.parseInt(nproc, 10);
    if (Number.isFinite(n)) return n;
  }
  const cpuinfo = run("grep -c ^processor /proc/cpuinfo 2>/dev/null");
  if (cpuinfo) {
    const n = Number.parseInt(cpuinfo, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function detectOllama(): string | null {
  const v = run("ollama --version 2>/dev/null");
  if (v) return v;
  // Also check if ollama is reachable
  const tags = run("curl -sf http://localhost:11434/api/tags 2>/dev/null | head -c 10");
  if (tags) return "(running, version unknown)";
  return null;
}

function gatherHardware(): HardwareReport {
  const gpus: HardwareReport["gpu"] = [];

  // Prefer nvidia-smi when available — it gives exact VRAM on all NVIDIA cards,
  // including DGX Spark (which reports unified memory via nvidia-smi).
  const nvidia = detectNvidia();
  if (nvidia) {
    // If nvidia-smi reports >100GB, unify the name to the DGX Spark label
    // so the user knows we recognised the platform.
    if (nvidia.vramMiB > 100 * 1024 && hasDGXSparkHeuristic()) {
      gpus.push({ ...nvidia, name: "NVIDIA DGX Spark (GB10, unified memory)" });
    } else {
      gpus.push(nvidia);
    }
  } else if (hasDGXSparkHeuristic()) {
    // nvidia-smi unavailable but platform signs point to DGX Spark
    gpus.push({ vendor: "nvidia", vramMiB: 120 * 1024, name: "NVIDIA DGX Spark (GB10, 128GB unified) — nvidia-smi missing" });
  }

  const amd = detectAMD();
  if (amd) gpus.push(amd);
  const intel = detectIntel();
  if (intel) gpus.push(intel);

  return {
    gpu: gpus,
    ramMiB: detectRAM(),
    cpuCores: detectCPU(),
    ollamaVersion: detectOllama(),
    os: run("uname -s") ?? "unknown",
  };
}

function recommend(report: HardwareReport): ModelTier[] {
  const totalVram = report.gpu
    .filter((g) => g.vramMiB > 0)
    .reduce((sum, g) => sum + g.vramMiB, 0);
  const ram = report.ramMiB;

  return TIERS.filter((t) => {
    // If we know VRAM, it gates. If we don't know VRAM (iGPU), RAM gates.
    if (totalVram > 0) {
      return t.minVramMiB <= totalVram && t.minRamMiB <= ram;
    }
    return t.minVramMiB === 0 && t.minRamMiB <= ram;
  });
}

function formatByteSize(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GB`;
  return `${mib} MB`;
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question + " ", (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const autoMode = args.includes("--auto");
  const dryRun = args.includes("--dry-run");
  const forceModelIdx = args.findIndex((a) => a === "--model");
  const forceModel = forceModelIdx >= 0 ? args[forceModelIdx + 1] : null;

  console.log("════════════════════════════════════════════════════");
  console.log("  GZMO Setup Wizard — Local Ollama Onboarding");
  console.log("════════════════════════════════════════════════════");
  console.log("");

  const report = gatherHardware();
  console.log("Hardware detected:");
  console.log(`  OS:      ${report.os}`);
  console.log(`  CPU:     ${report.cpuCores > 0 ? report.cpuCores + " cores" : "unknown"}`);
  console.log(`  RAM:     ${report.ramMiB > 0 ? formatByteSize(report.ramMiB) : "unknown"}`);
  if (report.gpu.length === 0) {
    console.log(`  GPU:     none detected (CPU-only inference)`);
  } else {
    for (const g of report.gpu) {
      const vramStr = g.vramMiB > 0 ? formatByteSize(g.vramMiB) : "unknown";
      console.log(`  GPU:     ${g.name} (${g.vendor}) — VRAM ${vramStr}`);
    }
  }
  console.log(`  Ollama:  ${report.ollamaVersion ?? "not found (install from ollama.com)"}`);
  console.log("");

  const candidates = recommend(report);
  let chosen: ModelTier | null = null;

  if (forceModel) {
    chosen = TIERS.find((t) => t.id === forceModel) || null;
    if (!chosen) {
      console.error(`Unknown model: ${forceModel}`);
      process.exit(1);
    }
    console.log(`Forcing model: ${chosen.id}`);
  } else if (autoMode || dryRun) {
    chosen = candidates[candidates.length - 1] ?? TIERS[0];
    console.log(`${dryRun ? "[DRY-RUN] Would auto-select" : "Auto-selected"}: ${chosen.id} (${chosen.name})`);
  } else if (candidates.length === 0) {
    console.log("WARNING: Your hardware is below our minimums for the tested model list.");
    console.log("Consider using qwen2.5:0.5b or phi3:mini anyway, or run Ollama on a remote machine.");
    chosen = TIERS[0];
    const ok = await ask(`Proceed with ${chosen.id}? [Y/n]`);
    if (ok.toLowerCase() === "n") process.exit(0);
  } else {
    console.log("Recommended models for your hardware:");
    candidates.forEach((t, i) => {
      const marker = i === candidates.length - 1 ? "  → best fit" : "";
      console.log(`  ${i + 1}) ${t.id.padEnd(22)} — ${t.name}${marker}`);
      console.log(`     ${t.notes}`);
      console.log("");
    });
    const choice = await ask(`Pick a model (1-${candidates.length}), or type a custom tag: `);
    const n = Number.parseInt(choice, 10);
    if (Number.isFinite(n) && n >= 1 && n <= candidates.length) {
      chosen = candidates[n - 1];
    } else if (choice.trim()) {
      chosen = { id: choice.trim(), name: choice.trim(), minVramMiB: 0, minRamMiB: 0, notes: "user-specified" };
    } else {
      chosen = candidates[candidates.length - 1];
    }
  }

  if (!chosen) {
    console.error("No model selected.");
    process.exit(1);
  }
  console.log(`Selected model: ${chosen.id}`);
  console.log("");

  const existingVault = run(`grep -E '^VAULT_PATH=' "${ENV_PATH}" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"'`) ?? "";
  let vaultPath = existingVault;
  if (!autoMode && !dryRun && (!vaultPath || !existsSync(vaultPath))) {
    const defaultVault = resolve(REPO_ROOT, "../gzmo-vault");
    const input = await ask(`Vault path [${defaultVault}]: `);
    vaultPath = input.trim() || defaultVault;
  }
  if (!vaultPath) {
    vaultPath = resolve(REPO_ROOT, "../gzmo-vault");
  }
  if (!vaultPath.startsWith("/")) {
    console.error("VAULT_PATH must be absolute.");
    process.exit(1);
  }

  const profile = (autoMode || dryRun) ? "core" : await ask("GZMO profile [core/standard/full/minimal] (default: core): ");
  const profileName = (profile.trim() || "core") as any;

  // Build env content, preserving old API keys as commented fallback
  let fallbackSection = "";
  if (existsSync(ENV_PATH)) {
    const oldRaw = run(`cat "${ENV_PATH}" 2>/dev/null`) ?? "";
    const apiKeys = oldRaw.split("\n").filter((l) => /^OPENROUTER_API_KEY=|^OPENAI_API_KEY=/.test(l));
    if (apiKeys.length > 0) {
      fallbackSection = "\n# ── Fallback remote config (preserved from previous setup) ──\n# " + apiKeys.join("\n# ") + "\n";
    }
  }

  const envContent = `# GZMO Daemon — Local Ollama Configuration
# Generated by setup-wizard.ts on ${new Date().toISOString()}
VAULT_PATH="${vaultPath}"
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="${chosen.id}"
GZMO_PROFILE="${profileName}"
${fallbackSection}`;

  if (dryRun) {
    console.log("");
    console.log("[DRY-RUN] Would write the following to gzmo-daemon/.env:");
    console.log("----------------------------------------");
    console.log(envContent);
    console.log("----------------------------------------");
    console.log("No changes written. Re-run without --dry-run to apply.");
    process.exit(0);
  }

  if (!autoMode) {
    console.log("");
    console.log("Will write the following to gzmo-daemon/.env:");
    console.log("----------------------------------------");
    console.log(envContent);
    console.log("----------------------------------------");
    const confirm = await ask("Write .env? [Y/n] ");
    if (confirm.toLowerCase() === "n") {
      console.log("Aborted. No changes written.");
      process.exit(0);
    }
  }

  // Backup existing .env
  if (existsSync(ENV_PATH)) {
    const backupPath = `${ENV_PATH}.backup.${Date.now()}`;
    writeFileSync(backupPath, run(`cat "${ENV_PATH}" 2>/dev/null`) ?? "", { encoding: "utf8" });
    console.log(`📦 Backup created: ${backupPath}`);
  }

  writeFileSync(ENV_PATH, envContent, { encoding: "utf8" });
  console.log(`✅ Wrote ${ENV_PATH}`);

  // Scaffold vault dirs
  const dirs = [
    `${vaultPath}/GZMO`,
    `${vaultPath}/GZMO/Inbox`,
    `${vaultPath}/GZMO/Subtasks`,
    `${vaultPath}/GZMO/Thought_Cabinet`,
    `${vaultPath}/GZMO/Quarantine`,
    `${vaultPath}/GZMO/Reasoning_Traces`,
    `${vaultPath}/wiki`,
  ];
  let created = 0;
  for (const d of dirs) {
    if (!existsSync(d)) {
      Bun.spawnSync(["mkdir", "-p", d]);
      created++;
    }
  }
  if (created > 0) console.log(`✅ Created ${created} vault directories.`);

  console.log("");
  console.log("Next steps:");
  if (!report.ollamaVersion) {
    console.log("  1) Install Ollama:     https://ollama.com/download");
    console.log("  2) Pull your model:    ollama pull " + chosen.id);
  } else {
    console.log("  1) Pull your model:    ollama pull " + chosen.id);
  }
  console.log("  2) Start the daemon:   cd gzmo-daemon && bun run summon");
  console.log("  3) Submit a task:      see README.md → Golden minimal task");
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });

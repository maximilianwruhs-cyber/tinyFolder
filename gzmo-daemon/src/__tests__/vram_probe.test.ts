import { afterEach, describe, expect, test } from "bun:test";
import { _resetVramProbeForTest, getVramSnapshot, parseNvidiaSmiOutput, resolveActiveMode } from "../vram_probe";

const ENV_KEYS = ["GZMO_VRAM_PROBE", "GZMO_VRAM_PROBE_INTERVAL_MS"] as const;
const original: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function restore() {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k] as string;
  }
}
function snap() {
  for (const k of ENV_KEYS) original[k] = process.env[k];
}

afterEach(() => {
  restore();
  _resetVramProbeForTest();
});

describe("parseNvidiaSmiOutput", () => {
  test("parses a single GPU row", () => {
    const out = parseNvidiaSmiOutput("18432, 32768\n");
    expect(out).toEqual({ used_mb: 18432, total_mb: 32768 });
  });

  test("aggregates multiple GPU rows", () => {
    const out = parseNvidiaSmiOutput("8192, 16384\n4096, 16384\n");
    expect(out).toEqual({ used_mb: 12288, total_mb: 32768 });
  });

  test("ignores blank lines and malformed rows", () => {
    const out = parseNvidiaSmiOutput("\n8192, 16384\nnot, a, row\n4096, 16384\n");
    expect(out).toEqual({ used_mb: 12288, total_mb: 32768 });
  });

  test("returns null on empty / unparseable input", () => {
    expect(parseNvidiaSmiOutput("")).toBeNull();
    expect(parseNvidiaSmiOutput("\n\n")).toBeNull();
    expect(parseNvidiaSmiOutput("garbage in, but no numbers")).toBeNull();
  });

  test("rejects rows with total_mb=0", () => {
    expect(parseNvidiaSmiOutput("0, 0\n")).toBeNull();
  });
});

describe("resolveActiveMode", () => {
  test("respects explicit env=off", async () => {
    snap();
    process.env.GZMO_VRAM_PROBE = "off";
    expect(await resolveActiveMode(async () => true)).toBe("off");
  });

  test("respects explicit env=env", async () => {
    snap();
    process.env.GZMO_VRAM_PROBE = "env";
    expect(await resolveActiveMode(async () => true)).toBe("env");
  });

  test("respects explicit env=nvidia-smi even when tool is missing", async () => {
    snap();
    process.env.GZMO_VRAM_PROBE = "nvidia-smi";
    expect(await resolveActiveMode(async () => false)).toBe("nvidia-smi");
  });

  test("auto: enables when nvidia-smi is available", async () => {
    snap();
    process.env.GZMO_VRAM_PROBE = "auto";
    expect(await resolveActiveMode(async () => true)).toBe("nvidia-smi");
  });

  test("auto: falls back to env when nvidia-smi missing", async () => {
    snap();
    process.env.GZMO_VRAM_PROBE = "auto";
    expect(await resolveActiveMode(async () => false)).toBe("env");
  });

  test("treats unknown values as auto", async () => {
    snap();
    process.env.GZMO_VRAM_PROBE = "wat";
    expect(await resolveActiveMode(async () => true)).toBe("nvidia-smi");
    expect(await resolveActiveMode(async () => false)).toBe("env");
  });
});

describe("getVramSnapshot", () => {
  test("returns undefined when the probe has never produced a reading", () => {
    expect(getVramSnapshot()).toBeUndefined();
  });
});

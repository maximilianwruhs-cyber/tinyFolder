/**
 * dropzone_convert.ts — Local-only document → Markdown for Dropzone ingest.
 *
 * No network I/O in this path. Handlers read bytes already on disk (see README).
 */

import Papa from "papaparse";
import { readBoolEnv, readIntEnv } from "./pipelines/helpers";

const DEFAULT_EXTENSIONS = ["pdf", "docx", "html", "htm", "txt", "text", "csv", "json"];

export interface DropzoneConvertConfig {
  enabled: boolean;
  maxBytes: number;
  timeoutMs: number;
  /** Lowercase extensions without leading dot */
  extensions: Set<string>;
}

/** Parse comma-separated extension list; empty entries dropped. */
export function parseExtensionAllowlist(raw: string | undefined): Set<string> {
  const s = (raw ?? "").trim();
  if (!s) return new Set(DEFAULT_EXTENSIONS);
  const parts = s
    .split(/[,;\s]+/)
    .map((x) => x.replace(/^\./, "").toLowerCase().trim())
    .filter(Boolean);
  return new Set(parts.length > 0 ? parts : DEFAULT_EXTENSIONS);
}

export function getDropzoneConvertConfig(): DropzoneConvertConfig {
  return {
    enabled: readBoolEnv("GZMO_DROPZONE_CONVERT", true),
    maxBytes: readIntEnv("GZMO_DROPZONE_CONVERT_MAX_BYTES", 52_428_800, 4096, 200 * 1024 * 1024),
    timeoutMs: readIntEnv("GZMO_DROPZONE_CONVERT_TIMEOUT_MS", 120_000, 5000, 600_000),
    extensions: parseExtensionAllowlist(process.env.GZMO_DROPZONE_CONVERT_EXTENSIONS),
  };
}

export function fileExtensionLower(name: string): string {
  const base = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return base.toLowerCase();
}

export function isExtensionConvertible(ext: string, cfg: DropzoneConvertConfig): boolean {
  if (!cfg.enabled) return false;
  const e = ext.replace(/^\./, "").toLowerCase();
  return cfg.extensions.has(e);
}

export interface ConvertOk {
  markdown: string;
  handler: string;
  /** Merged into wiki frontmatter when present (e.g. PDF triage). */
  extraFrontmatter?: Record<string, unknown>;
}

function decodeUtf8Text(buf: Uint8Array): string {
  let s = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

function jsonToMarkdown(jsonStr: string): string {
  const max = 200_000;
  try {
    const v = JSON.parse(jsonStr) as unknown;
    const pretty = JSON.stringify(v, null, 2);
    const body =
      pretty.length > max
        ? `${pretty.slice(0, max)}\n\n_(truncated for display — split the file or raise limits if needed.)_`
        : pretty;
    return ["```json", body, "```", ""].join("\n");
  } catch {
    return ["```text", jsonStr.slice(0, Math.min(jsonStr.length, max)), "```", ""].join("\n");
  }
}

function convertCsv(buf: Uint8Array): string {
  const text = decodeUtf8Text(buf);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const rows = parsed.data.filter((r) => Object.keys(r).some((k) => String(r[k] ?? "").trim() !== ""));
  if (rows.length === 0) return "_Empty or unparseable CSV._\n";

  const headers = Object.keys(rows[0]!);
  const esc = (c: string) => String(c ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const headRow = `| ${headers.map(esc).join(" | ")} |`;
  const sepRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataRows = rows.map((r) => `| ${headers.map((h) => esc(r[h] ?? "")).join(" | ")} |`);
  return [headRow, sepRow, ...dataRows, ""].join("\n");
}

async function convertHtml(buf: Uint8Array): Promise<string> {
  const { convert } = await import("html-to-text");
  const html = decodeUtf8Text(buf);
  const text = convert(html, {
    wordwrap: 120,
    selectors: [{ selector: "a", options: { hideLinkHrefIfSameAsText: true } }],
  });
  return text.trim() ? `${text.trim()}\n` : "_No textual content extracted from HTML._\n";
}

async function convertDocx(buf: Uint8Array): Promise<string> {
  /** mammoth ships convertToMarkdown at runtime; published .d.ts is incomplete */
  type MammothMd = {
    convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string }>;
  };
  const mammoth = (await import("mammoth")) as unknown as MammothMd;
  const { value } = await mammoth.convertToMarkdown({ buffer: Buffer.from(buf) });
  return value.trim() ? `${value.trim()}\n` : "_Empty DOCX (no extractable text)._\n";
}

async function convertPdf(buf: Uint8Array): Promise<ConvertOk> {
  // Peak memory ≈ 2× PDF bytes: we copy into `data` for pdfjs transfer semantics.
  const { PDFParse } = await import("pdf-parse");
  const data = new Uint8Array(buf.byteLength);
  data.set(buf);
  const parser = new PDFParse({ data });
  try {
    const tr = await parser.getText();
    const t = (tr.text ?? "").trim();
    const pages = tr.pages ?? [];
    const pageLens = pages.map((p) => (p.text ?? "").trim().length);
    const firstLen = pageLens[0] ?? 0;
    const totalLen = t.length;
    let triage: string;
    if (totalLen < 50) triage = "likely_scan_or_empty";
    else if (firstLen < 40 && pageLens.some((c, i) => i > 0 && c >= 40)) triage = "mixed_text_starts_late";
    else triage = "text_layer_ok";

    const markdown = t ? `${t}\n` : "_No text layer found in PDF (likely image-only / scan)._\n";
    return {
      markdown,
      handler: "pdf",
      extraFrontmatter: { dropzone_pdf_triage: triage },
    };
  } finally {
    try {
      await parser.destroy();
    } catch {
      // ignore
    }
  }
}

function withTimeout<T>(ms: number, run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`convert_timeout_after_${ms}ms`)), ms);
    run()
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

/**
 * Attempt conversion. Throws on failure; caller falls back to binary stub.
 */
export async function convertDropzoneBuffer(
  extLower: string,
  buf: Uint8Array,
  cfg: DropzoneConvertConfig,
): Promise<ConvertOk> {
  const ext = extLower.replace(/^\./, "").toLowerCase();

  return withTimeout(cfg.timeoutMs, async () => {
    switch (ext) {
      case "txt":
      case "text": {
        const md = decodeUtf8Text(buf);
        return { markdown: md.endsWith("\n") ? md : `${md}\n`, handler: "utf8_text" };
      }
      case "json": {
        return { markdown: jsonToMarkdown(decodeUtf8Text(buf)), handler: "json" };
      }
      case "csv": {
        return { markdown: convertCsv(buf), handler: "csv" };
      }
      case "html":
      case "htm": {
        return { markdown: await convertHtml(buf), handler: "html" };
      }
      case "docx": {
        return { markdown: await convertDocx(buf), handler: "docx" };
      }
      case "pdf": {
        return await convertPdf(buf);
      }
      default:
        throw new Error(`unsupported_extension:${ext}`);
    }
  });
}

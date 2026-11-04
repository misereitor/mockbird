/**
 * find.mjs — busca direta no alvo de design: "onde está <termo>?" em uma consulta.
 *
 * Usage: node find.mjs "<termo>" [--target <dir>] [--campo texto|classe|token|data|icone|arquivo] [--json]
 *   --target <dir>  alvo da busca (default: design/)
 *   --campo <c>     restringe a um campo (default: todos)
 *   --json          saída JSON {termo, alvo, campo, fonte, total, hits}
 *
 * Human output is grep-style `arquivo:linha: preview` (one line per hit) plus
 * the total count as the FINAL line ("N ocorrências"). Hits are sorted by
 * (arquivo, linha, campo) - deterministic, no locale dependence. One hit per
 * (linha, campo): a term that repeats on the same line and campo counts once.
 * Nothing is ever truncated: every hit is printed and the total is always shown.
 *
 * The query is matched as a LITERAL substring (String#includes). It is never
 * compiled as a regex, so metacharacters are inert: `preço (R$)` and `a.*b`
 * match only their literal text. No eval, no shell, no subprocesses.
 *
 * Campos (each occurrence is classified into exactly one campo):
 *   arquivo  relative file path (every file, including non-text ones)
 *   texto    visible text, comments, and any markup outside the rules below
 *   classe   class="..." attribute name/value in HTML
 *   token    whole content of tokens.json / tokens.*.json (names and values)
 *   data     data-* attribute name/value in HTML
 *   icone    svg icon paths: attribute values containing ".svg", <path d="...">
 *            data-icon/data-icone and <use href="..."> in HTML
 *
 * Search source: `<alvo>/.map/index.json` (optional index refreshed by
 * /design-map; buildIndex() below is the generator contract, schemaVersion 1).
 * The index is used only when its shape validates AND its file list matches the
 * disk walk; otherwise a direct scan runs (sem índice, varredura - sempre
 * correta). find.mjs itself NEVER writes to the target or anywhere else.
 *
 * Preview lines are sanitized: control characters (e.g. ANSI escapes) are
 * rendered as \xNN and the line is capped at 160 chars with "...".
 *
 * Exit codes: 0 >=1 hit, 1 zero hits ("0 ocorrências"), 2 usage/input error
 * (empty term, unknown --campo/flag, missing/unreadable target).
 *
 * Pure functions + thin CLI, Node 18+, stdlib only (node:fs, node:path,
 * node:url), ZERO deps. Import-safe: the CLI runs only when executed directly.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CAMPOS = Object.freeze(["texto", "classe", "token", "data", "icone", "arquivo"]);

const INDEX_SCHEMA = 1;
const SKIP_DIRS = new Set([".map", ".git", "node_modules"]);
const HTML_EXT = new Set([".html", ".htm", ".svg"]);
const TEXT_EXT = new Set([".css", ".js", ".mjs", ".json", ".md", ".txt"]);
const PREVIEW_MAX = 160;

const usage = 'usage: find.mjs "<termo>" [--target <dir>] [--campo texto|classe|token|data|icone|arquivo] [--json]';

function fail(message) {
  process.stderr.write(`find.mjs: ${message}\n`);
  process.exit(2);
}

// ---- field classification -------------------------------------------------

function classifyFile(relPath) {
  const name = relPath.split("/").pop();
  if (name === "tokens.json" || /^tokens\..+\.json$/.test(name)) return "token";
  const ext = extname(name).toLowerCase();
  if (HTML_EXT.has(ext)) return "html";
  if (TEXT_EXT.has(ext)) return "text";
  return null; // binary/unknown: only the arquivo row is searchable
}

function attrNameCampo(attr) {
  if (attr === "data-icon" || attr === "data-icone") return "icone";
  if (attr === "class" || attr === "classname") return "classe";
  if (attr.startsWith("data-")) return "data";
  return "texto";
}

function attrValueCampo(tag, attr, value) {
  if (value.toLowerCase().includes(".svg")) return "icone";
  if (attr === "data-icon" || attr === "data-icone") return "icone";
  if (tag === "path" && attr === "d") return "icone";
  if (tag === "use" && (attr === "href" || attr === "xlink:href")) return "icone";
  if (attr === "class" || attr === "classname") return "classe";
  if (attr.startsWith("data-")) return "data";
  return "texto";
}

/**
 * Classify an HTML/SVG document into non-overlapping text spans
 * ({campo, start, end} over content offsets). Line-based per-occurrence rules:
 * comment/text nodes -> texto; attribute name/value pairs -> their campo.
 * Malformed markup degrades to texto (search stays complete, never crashes).
 */
export function htmlSpans(content) {
  const spans = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    const lt = content.indexOf("<", i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) spans.push({ campo: "texto", start: i, end: textEnd });
    if (lt === -1) break;
    if (content.startsWith("<!--", lt)) {
      let end = content.indexOf("-->", lt + 4);
      end = end === -1 ? n : end + 3;
      spans.push({ campo: "texto", start: lt, end });
      i = end;
      continue;
    }
    const next = content[lt + 1];
    if (next === undefined) {
      spans.push({ campo: "texto", start: lt, end: n });
      break;
    }
    if (next === "!" || next === "?" || next === "/") {
      let end = content.indexOf(">", lt + 2);
      end = end === -1 ? n : end + 1;
      spans.push({ campo: "texto", start: lt, end });
      i = end;
      continue;
    }
    if (!/[a-zA-Z]/.test(next)) {
      spans.push({ campo: "texto", start: lt, end: lt + 1 });
      i = lt + 1;
      continue;
    }
    let j = lt + 1;
    const nameStart = j;
    while (j < n && !/[\s/>]/.test(content[j])) j++;
    const tag = content.slice(nameStart, j).toLowerCase();
    spans.push({ campo: "texto", start: nameStart, end: j });
    while (j < n && content[j] !== ">") {
      const ch = content[j];
      if (ch === "<") break; // malformed tag: re-lex from here
      if (/[\s/]/.test(ch)) {
        j++;
        continue;
      }
      const attrStart = j;
      while (j < n && !/[\s=/>]/.test(content[j]) && content[j] !== "<") j++;
      const attr = content.slice(attrStart, j).toLowerCase();
      let k = j;
      while (k < n && /\s/.test(content[k])) k++;
      if (content[k] === "=") {
        k++;
        while (k < n && /\s/.test(content[k])) k++;
        const quote = content[k];
        let vStart;
        let vEnd;
        if (quote === '"' || quote === "'") {
          vStart = k + 1;
          vEnd = content.indexOf(quote, vStart);
          if (vEnd === -1) vEnd = n;
          j = vEnd + 1;
        } else {
          vStart = k;
          while (k < n && !/[\s>]/.test(content[k]) && content[k] !== "<") k++;
          vEnd = k;
          j = vEnd;
        }
        if (attr) {
          const value = content.slice(vStart, vEnd);
          spans.push({ campo: attrValueCampo(tag, attr, value), start: vStart, end: vEnd });
        }
      } else {
        j = k;
      }
      if (attr) spans.push({ campo: attrNameCampo(attr), start: attrStart, end: attrStart + attr.length });
    }
    i = content[j] === ">" ? j + 1 : j;
  }
  return spans;
}

// ---- scanning -------------------------------------------------------------

function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  out.sort();
  return out;
}

function lineStarts(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Rows are {campo, linha, text, preview}: `text` is what the term matches
 * against, `preview` is the raw source line shown on output. */
function rowsForFile(abs, rel) {
  const rows = [{ campo: "arquivo", linha: 1, text: rel, preview: rel }];
  const kind = classifyFile(rel);
  if (kind === null) return rows;
  const content = readFileSync(abs, "utf8");
  const lines = content.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (kind === "html") {
    const starts = lineStarts(content);
    for (const span of htmlSpans(content)) {
      const text = content.slice(span.start, span.end);
      let pos = span.start;
      for (const piece of text.split("\n")) {
        const linha = lineOf(starts, pos);
        const clean = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
        if (clean) rows.push({ campo: span.campo, linha, text: clean, preview: lines[linha - 1] ?? "" });
        pos += piece.length + 1;
      }
    }
  } else {
    const campo = kind === "token" ? "token" : "texto";
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) rows.push({ campo, linha: i + 1, text: lines[i], preview: lines[i] });
    }
  }
  return rows;
}

/** Full scan of the target: {files: [{path, rows}]}, sorted by path. */
export function scanTarget(target) {
  const root = resolve(target);
  const files = listFiles(root).map((rel) => ({ path: rel, rows: rowsForFile(join(root, rel), rel) }));
  return { files };
}

/** Generator contract for `<alvo>/.map/index.json` (written by /design-map,
 * todo 6). find.mjs never writes; it only consumes this shape. */
export function buildIndex(target) {
  return { schemaVersion: INDEX_SCHEMA, generator: "find.mjs", files: scanTarget(target).files };
}

function loadIndex(root, relPaths) {
  const indexPath = join(root, ".map", "index.json");
  if (!existsSync(indexPath)) return null;
  let data;
  try {
    data = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }
  if (!data || data.schemaVersion !== INDEX_SCHEMA || !Array.isArray(data.files)) return null;
  const paths = [];
  for (const file of data.files) {
    if (!file || typeof file.path !== "string" || !Array.isArray(file.rows)) return null;
    paths.push(file.path);
    for (const row of file.rows) {
      if (
        !row ||
        typeof row.text !== "string" ||
        typeof row.preview !== "string" ||
        typeof row.linha !== "number" ||
        !CAMPOS.includes(row.campo)
      ) {
        return null;
      }
    }
  }
  paths.sort();
  // Guard against a stale index (file added/removed): fall back to the scan.
  if (paths.length !== relPaths.length || paths.some((p, idx) => p !== relPaths[idx])) return null;
  return data.files;
}

// ---- query ----------------------------------------------------------------

/** Control chars are rendered as \xNN so untrusted content can never emit
 * terminal escapes; long previews are capped with "...". */
export function sanitizePreview(line) {
  let out = "";
  for (const ch of line) {
    const code = ch.codePointAt(0);
    out += code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0").toUpperCase()}` : ch;
  }
  const chars = [...out];
  return chars.length > PREVIEW_MAX ? `${chars.slice(0, PREVIEW_MAX).join("")}...` : out;
}

/** Literal substring match (never regex). One hit per (linha, campo), sorted
 * by (arquivo, linha, campo). */
export function searchFiles(files, term, campo) {
  const hits = [];
  for (const file of files) {
    const seen = new Set();
    for (const row of file.rows) {
      if (campo !== null && row.campo !== campo) continue;
      if (!row.text.includes(term)) continue;
      const key = `${row.linha}:${row.campo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ arquivo: file.path, linha: row.linha, campo: row.campo, preview: sanitizePreview(row.preview) });
    }
  }
  hits.sort((a, b) =>
    a.arquivo !== b.arquivo ? (a.arquivo < b.arquivo ? -1 : 1) : a.linha !== b.linha ? a.linha - b.linha : a.campo < b.campo ? -1 : a.campo > b.campo ? 1 : 0
  );
  return hits;
}

// ---- CLI ------------------------------------------------------------------

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function main(argv) {
  let term = null;
  let target = "design";
  let campo = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") {
      if (i + 1 >= argv.length) fail(`--target requires a path - ${usage}`);
      target = argv[++i];
    } else if (arg === "--campo") {
      if (i + 1 >= argv.length) fail(`--campo requires one of ${CAMPOS.join("|")} - ${usage}`);
      const value = argv[++i];
      if (!CAMPOS.includes(value)) fail(`unknown campo "${value}" - campos válidos: ${CAMPOS.join(", ")}`);
      campo = value;
    } else if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("-")) {
      fail(`unknown argument "${arg}" - ${usage}`);
    } else if (term === null) {
      term = arg;
    } else {
      fail(`unexpected extra argument "${arg}" - ${usage}`);
    }
  }
  if (term === null || term.trim() === "") fail(`termo vazio - ${usage}`);
  const root = resolve(target);
  if (!isDirectory(root)) fail(`alvo não encontrado: ${target}`);

  const relPaths = listFiles(root);
  const indexed = loadIndex(root, relPaths);
  const files = indexed ?? relPaths.map((rel) => ({ path: rel, rows: rowsForFile(join(root, rel), rel) }));
  const hits = searchFiles(files, term, campo);

  if (json) {
    const payload = { termo: term, alvo: target, campo, fonte: indexed ? "index" : "scan", total: hits.length, hits };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (hits.length === 0) process.stderr.write("0 ocorrências\n");
  } else {
    for (const hit of hits) process.stdout.write(`${hit.arquivo}:${hit.linha}: ${hit.preview}\n`);
    process.stdout.write(`${hits.length} ${hits.length === 1 ? "ocorrência" : "ocorrências"}\n`);
  }
  return hits.length > 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

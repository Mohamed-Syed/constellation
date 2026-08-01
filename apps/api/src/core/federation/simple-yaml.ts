/**
 * A deliberately SMALL YAML subset parser, sufficient for `config/modules.yaml`.
 *
 * WHY NOT `js-yaml`: it exists in the pnpm store but is not a declared
 * dependency of `apps/api`, and this round forbids `pnpm add`. Rather than
 * reach into another package's node_modules (fragile and dishonest), this
 * parses the exact subset the registry file uses. **Recommendation to the
 * orchestrator: add `js-yaml` + `@types/js-yaml` to `apps/api` and replace
 * this file** — it's ~100 lines of parser we shouldn't own long-term.
 *
 * SUPPORTED (everything `modules.yaml` needs):
 *  - two-space nested mappings
 *  - block sequences of mappings (`- key: value`) and of scalars (`- value`)
 *  - scalars: strings (bare/quoted), integers, floats, booleans, null
 *  - `#` comments (full-line and trailing, respecting quotes)
 *  - `${ENV_VAR:-default}` interpolation from `process.env`
 *
 * NOT SUPPORTED (and rejected loudly rather than silently mis-parsed):
 *  - flow collections (`{a: 1}` / `[1, 2]`), anchors/aliases, multi-line
 *    block scalars (`|`, `>`), multiple documents, tabs for indentation.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

interface Line {
  indent: number;
  content: string;
  lineNo: number;
}

export class YamlParseError extends Error {
  constructor(message: string, lineNo: number) {
    super(`modules.yaml: ${message} (line ${lineNo})`);
    this.name = "YamlParseError";
  }
}

/** Parse the supported YAML subset into a plain JS value. */
export function parseSimpleYaml(source: string): YamlValue {
  const lines: Line[] = [];

  source.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    if (raw.includes("\t")) {
      const beforeContent = raw.slice(0, raw.length - raw.trimStart().length);
      if (beforeContent.includes("\t")) throw new YamlParseError("tabs are not valid YAML indentation", lineNo);
    }
    const stripped = stripComment(raw);
    if (!stripped.trim()) return; // blank or comment-only
    if (stripped.trimStart().startsWith("---")) return; // document marker
    lines.push({ indent: stripped.length - stripped.trimStart().length, content: stripped.trim(), lineNo });
  });

  if (lines.length === 0) return {};
  const [value, consumed] = parseBlock(lines, 0, lines[0]!.indent);
  if (consumed < lines.length) {
    throw new YamlParseError(`unexpected content "${lines[consumed]!.content}"`, lines[consumed]!.lineNo);
  }
  return value;
}

function parseBlock(lines: Line[], start: number, indent: number): [YamlValue, number] {
  if (start >= lines.length) return [null, start];
  return lines[start]!.content.startsWith("- ") || lines[start]!.content === "-"
    ? parseSequence(lines, start, indent)
    : parseMapping(lines, start, indent);
}

function parseSequence(lines: Line[], start: number, indent: number): [YamlValue[], number] {
  const items: YamlValue[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlParseError(`unexpected indentation in sequence`, line.lineNo);
    if (!line.content.startsWith("- ") && line.content !== "-") break;

    const rest = line.content === "-" ? "" : line.content.slice(2).trim();
    i += 1;

    if (!rest) {
      // "-" alone: the item is the nested block beneath it.
      if (i < lines.length && lines[i]!.indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i]!.indent);
        items.push(value);
        i = next;
      } else {
        items.push(null);
      }
      continue;
    }

    const colon = findKeySeparator(rest);
    if (colon === -1) {
      items.push(parseScalar(rest, line.lineNo)); // plain scalar item
      continue;
    }

    // "- key: value" — an inline mapping whose remaining keys are indented
    // to the column where `key` began.
    const childIndent = indent + 2;
    const synthetic: Line[] = [{ indent: childIndent, content: rest, lineNo: line.lineNo }];
    while (i < lines.length && lines[i]!.indent >= childIndent) {
      synthetic.push(lines[i]!);
      i += 1;
    }
    const [value] = parseMapping(synthetic, 0, childIndent);
    items.push(value);
  }

  return [items, i];
}

function parseMapping(lines: Line[], start: number, indent: number): [{ [k: string]: YamlValue }, number] {
  const map: { [k: string]: YamlValue } = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlParseError("unexpected indentation in mapping", line.lineNo);
    if (line.content.startsWith("- ")) break;

    const colon = findKeySeparator(line.content);
    if (colon === -1) throw new YamlParseError(`expected "key: value", got "${line.content}"`, line.lineNo);

    const key = unquote(line.content.slice(0, colon).trim());
    const inline = line.content.slice(colon + 1).trim();
    i += 1;

    if (inline) {
      map[key] = parseScalar(inline, line.lineNo);
      continue;
    }

    // Value lives in the block below. A sequence may sit at the SAME indent
    // as its key (idiomatic YAML), so accept that too.
    if (i < lines.length && (lines[i]!.indent > indent || (lines[i]!.indent === indent && lines[i]!.content.startsWith("- ")))) {
      const [value, next] = parseBlock(lines, i, lines[i]!.indent);
      map[key] = value;
      i = next;
    } else {
      map[key] = null;
    }
  }

  return [map, i];
}

/** Index of the ":" that separates a key from its value, ignoring quoted text. */
function findKeySeparator(text: string): number {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":" && (i + 1 === text.length || text[i + 1] === " ")) return i;
  }
  return -1;
}

/** Remove a trailing `#` comment that isn't inside quotes. */
function stripComment(raw: string): string {
  let quote: string | undefined;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (i === 0 || raw[i - 1] === " ")) return raw.slice(0, i);
  }
  return raw;
}

function unquote(text: string): string {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseScalar(raw: string, lineNo: number): YamlValue {
  const text = raw.trim();

  if (text.startsWith("[") || text.startsWith("{")) {
    throw new YamlParseError("flow collections are not supported by this parser", lineNo);
  }
  if (text === "|" || text === ">") {
    throw new YamlParseError("block scalars are not supported by this parser", lineNo);
  }

  const quoted = text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")));
  if (quoted) return interpolateEnv(text.slice(1, -1));

  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~" || text === "") return null;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);

  return interpolateEnv(text);
}

/** Expand `${VAR}` and `${VAR:-default}` from the process environment. */
export function interpolateEnv(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, name: string, fallback?: string) => {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
    return fallback ?? "";
  });
}

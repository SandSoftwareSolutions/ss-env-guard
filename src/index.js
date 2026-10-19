const KINDS = new Set(["string", "number", "integer", "boolean", "port", "url", "enum", "list"]);
const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);
// Plain decimal numbers only: Number() would also accept "0x10", "0b11", "0o7" and "1_000"-like surprises.
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Thrown when the environment does not match the schema. `problems` lists every problem, not just the first. */
export class EnvError extends Error {
  constructor(problems) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p.name}: ${p.message}`).join("\n")}`);
    this.name = "EnvError";
    this.problems = problems;
  }
}

class Fail extends Error {}
const fail = (message) => {
  throw new Fail(message);
};
const shown = (raw) => (raw.length > 40 ? `${JSON.stringify(raw.slice(0, 40))}...` : JSON.stringify(raw));

function checkSchema(schema) {
  if (schema === null || typeof schema !== "object") throw new TypeError("defineEnv: the schema must be an object");
  for (const [name, spec] of Object.entries(schema)) {
    if (spec === null || typeof spec !== "object") throw new TypeError(`defineEnv: ${name} needs a description object such as { type: "string" }`);
    const kind = spec.type ?? "string";
    if (!KINDS.has(kind)) throw new TypeError(`defineEnv: ${name} has unknown type "${kind}"`);
    if (kind === "enum" && (!Array.isArray(spec.values) || spec.values.length === 0)) {
      throw new TypeError(`defineEnv: ${name} is an enum and needs a non-empty "values" list`);
    }
  }
}

function convert(spec, raw) {
  const kind = spec.type ?? "string";
  const range = (n) => {
    if (spec.min !== undefined && n < spec.min) fail(`must be at least ${spec.min}${spec.secret ? "" : `, got ${raw}`}`);
    if (spec.max !== undefined && n > spec.max) fail(`must be at most ${spec.max}${spec.secret ? "" : `, got ${raw}`}`);
    return n;
  };
  switch (kind) {
    case "string":
      if (spec.minLength !== undefined && raw.length < spec.minLength) fail(`must be at least ${spec.minLength} characters`);
      if (spec.pattern) {
        spec.pattern.lastIndex = 0; // a pattern with the g or y flag remembers where it stopped
        if (!spec.pattern.test(raw)) fail("does not match the expected format");
      }
      return raw;
    case "number": {
      const n = Number(raw);
      if (!DECIMAL.test(raw.trim()) || !Number.isFinite(n)) fail(`must be a number${spec.secret ? "" : `, got ${shown(raw)}`}`);
      return range(n);
    }
    case "integer":
    case "port": {
      if (!/^[+-]?\d+$/.test(raw.trim())) fail(`must be a whole number${spec.secret ? "" : `, got ${shown(raw)}`}`);
      const n = Number(raw);
      if (!Number.isSafeInteger(n)) fail(`must be a whole number that fits${spec.secret ? "" : `, got ${shown(raw)}`}`);
      if (kind === "port" && (n < 1 || n > 65535)) fail(`must be a port between 1 and 65535${spec.secret ? "" : `, got ${raw}`}`);
      return range(n);
    }
    case "boolean": {
      const v = raw.trim().toLowerCase();
      if (TRUE.has(v)) return true;
      if (FALSE.has(v)) return false;
      return fail("must be true or false (also 1/0, yes/no, on/off)");
    }
    case "url": {
      let url;
      try {
        url = new URL(raw);
      } catch {
        return fail("must be a valid URL");
      }
      if (spec.protocols && !spec.protocols.includes(url.protocol.replace(/:$/, ""))) {
        fail(`must use one of: ${spec.protocols.join(", ")}`);
      }
      return raw;
    }
    case "enum":
      if (!spec.values.includes(raw)) fail(`must be one of: ${spec.values.join(", ")}${spec.secret ? "" : `, got ${shown(raw)}`}`);
      return raw;
    case "list":
      return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

// A plain assignment would turn a variable called __proto__ into a change of the prototype.
const set = (object, name, value) => Object.defineProperty(object, name, { value, enumerable: true, writable: true, configurable: true });

/**
 * Validates the environment against a schema and returns a frozen, typed object. Every problem is reported at once.
 * Secret values never appear in error messages. An empty variable counts as missing.
 */
export function defineEnv(schema, { source = process.env } = {}) {
  checkSchema(schema);
  const values = {};
  const problems = [];
  for (const [name, spec] of Object.entries(schema)) {
    const raw = Object.hasOwn(source, name) ? source[name] : undefined; // "constructor" or "toString" are not variables
    if (raw === undefined || raw === "") {
      if ("default" in spec) set(values, name, spec.default);
      else if (spec.optional) set(values, name, undefined);
      else problems.push({ name, message: "is required but missing" });
      continue;
    }
    try {
      set(values, name, convert(spec, raw));
    } catch (error) {
      if (!(error instanceof Fail)) throw error;
      problems.push({ name, message: error.message });
    }
  }
  if (problems.length > 0) throw new EnvError(problems);
  return Object.freeze(values);
}

// Bare when that reads back the same; otherwise single quotes, which every .env reader takes literally. A value with a line break
// or a single quote cannot be written safely for all readers, so it is left empty (the schema still has it).
function exampleValue(text) {
  if (text === "" || /^[A-Za-z0-9_./:@%+,=-]+$/.test(text)) return text;
  return /['\r\n]/.test(text) ? "" : `'${text}'`;
}

/** The text of a `.env.example` for the schema: descriptions, whether a value is required, and the defaults (never for secrets). */
export function exampleEnv(schema) {
  checkSchema(schema);
  const blocks = [];
  for (const [name, spec] of Object.entries(schema)) {
    const kind = spec.type ?? "string";
    const needed = "default" in spec ? "optional, has a default" : spec.optional ? "optional" : "required";
    const lines = [];
    if (spec.description) lines.push(...String(spec.description).split(/\r?\n/).map((l) => `# ${l}`)); // a line break must not become a variable
    const extra = kind === "enum" ? `: ${spec.values.join(" | ")}` : "";
    lines.push(`# ${needed}, ${kind}${extra}${spec.secret ? ", secret" : ""}`);
    const def = "default" in spec && !spec.secret && spec.default !== undefined ? String(Array.isArray(spec.default) ? spec.default.join(",") : spec.default) : "";
    lines.push(`${name}=${exampleValue(def)}`);
    blocks.push(lines.join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}

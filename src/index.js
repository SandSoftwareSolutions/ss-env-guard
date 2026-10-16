const KINDS = new Set(["string", "number", "integer", "boolean", "port", "url", "enum", "list"]);
const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

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
    const kind = spec?.type ?? "string";
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
      if (spec.pattern && !spec.pattern.test(raw)) fail("does not match the expected format");
      return raw;
    case "number": {
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(n)) fail(`must be a number${spec.secret ? "" : `, got ${shown(raw)}`}`);
      return range(n);
    }
    case "integer":
    case "port": {
      if (!/^[+-]?\d+$/.test(raw.trim())) fail(`must be a whole number${spec.secret ? "" : `, got ${shown(raw)}`}`);
      const n = Number(raw);
      if (kind === "port" && (n < 1 || n > 65535)) fail(`must be a port between 1 and 65535, got ${raw}`);
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

/**
 * Validates the environment against a schema and returns a frozen, typed object. Every problem is reported at once.
 * Secret values never appear in error messages. An empty variable counts as missing.
 */
export function defineEnv(schema, { source = process.env } = {}) {
  checkSchema(schema);
  const values = {};
  const problems = [];
  for (const [name, spec] of Object.entries(schema)) {
    const raw = source[name];
    if (raw === undefined || raw === "") {
      if ("default" in spec) values[name] = spec.default;
      else if (spec.optional) values[name] = undefined;
      else problems.push({ name, message: "is required but missing" });
      continue;
    }
    try {
      values[name] = convert(spec, raw);
    } catch (error) {
      if (!(error instanceof Fail)) throw error;
      problems.push({ name, message: error.message });
    }
  }
  if (problems.length > 0) throw new EnvError(problems);
  return Object.freeze(values);
}

/** The text of a `.env.example` for the schema: descriptions, whether a value is required, and the defaults (never for secrets). */
export function exampleEnv(schema) {
  checkSchema(schema);
  const blocks = [];
  for (const [name, spec] of Object.entries(schema)) {
    const kind = spec.type ?? "string";
    const needed = "default" in spec ? "optional, has a default" : spec.optional ? "optional" : "required";
    const lines = [];
    if (spec.description) lines.push(`# ${spec.description}`);
    const extra = kind === "enum" ? `: ${spec.values.join(" | ")}` : "";
    lines.push(`# ${needed}, ${kind}${extra}${spec.secret ? ", secret" : ""}`);
    const def = "default" in spec && !spec.secret && spec.default !== undefined ? String(Array.isArray(spec.default) ? spec.default.join(",") : spec.default) : "";
    lines.push(`${name}=${def}`);
    blocks.push(lines.join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}

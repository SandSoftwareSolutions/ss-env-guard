import assert from "node:assert/strict";
import { test } from "node:test";

import { defineEnv, EnvError, exampleEnv } from "./src/index.js";

const schema = {
  PORT: { type: "port", default: 3000 },
  DATABASE_URL: { type: "url", protocols: ["postgres", "postgresql"] },
  DEBUG: { type: "boolean", default: false },
  MODE: { type: "enum", values: ["dev", "prod"], default: "dev" },
  SESSION_SECRET: { type: "string", secret: true, minLength: 16 },
  ORIGINS: { type: "list", default: [] },
  SENTRY: { type: "url", optional: true }
};

test("converts and applies defaults", () => {
  const env = defineEnv(schema, {
    source: { DATABASE_URL: "postgres://u:p@db/app", SESSION_SECRET: "x".repeat(20), ORIGINS: "a.nl, b.nl,,", DEBUG: "YES" }
  });
  assert.deepEqual({ ...env }, {
    PORT: 3000, DATABASE_URL: "postgres://u:p@db/app", DEBUG: true, MODE: "dev",
    SESSION_SECRET: "x".repeat(20), ORIGINS: ["a.nl", "b.nl"], SENTRY: undefined
  });
  assert.ok(Object.isFrozen(env));
});

test("reports every problem at once and never shows a secret", () => {
  const secret = "short-secret";
  try {
    defineEnv(schema, { source: { PORT: "70000", DATABASE_URL: "mysql://x", DEBUG: "maybe", MODE: "stage", SESSION_SECRET: secret } });
    assert.fail("should throw");
  } catch (error) {
    assert.ok(error instanceof EnvError);
    assert.deepEqual(error.problems.map((p) => p.name), ["PORT", "DATABASE_URL", "DEBUG", "MODE", "SESSION_SECRET"]);
    assert.ok(!error.message.includes(secret));
    assert.match(error.message, /PORT: must be a port between 1 and 65535/);
  }
});

test("a missing or empty variable is required unless optional or defaulted", () => {
  assert.throws(() => defineEnv({ A: {} }, { source: {} }), /A: is required but missing/);
  assert.throws(() => defineEnv({ A: {} }, { source: { A: "" } }), /A: is required but missing/);
  assert.equal(defineEnv({ A: { optional: true } }, { source: {} }).A, undefined);
});

test("numbers and integers", () => {
  const env = defineEnv({ N: { type: "number", min: 0, max: 1 }, I: { type: "integer" } }, { source: { N: "0.5", I: "-3" } });
  assert.equal(env.N, 0.5);
  assert.equal(env.I, -3);
  assert.throws(() => defineEnv({ I: { type: "integer" } }, { source: { I: "1.5" } }), /whole number/);
  assert.throws(() => defineEnv({ N: { type: "number", max: 1 } }, { source: { N: "2" } }), /at most 1/);
  assert.throws(() => defineEnv({ N: { type: "number" } }, { source: { N: "abc" } }), /must be a number/);
});

test("a bad schema is a programming error", () => {
  assert.throws(() => defineEnv({ A: { type: "nope" } }, { source: {} }), TypeError);
  assert.throws(() => defineEnv({ A: { type: "enum" } }, { source: {} }), TypeError);
});

test("exampleEnv describes the schema and hides secret defaults", () => {
  const text = exampleEnv({ ...schema, TOKEN: { type: "string", secret: true, default: "hunter2", description: "API token" } });
  assert.match(text, /PORT=3000/);
  assert.match(text, /# required, url\nDATABASE_URL=\n/);
  assert.match(text, /# API token\n# optional, has a default, string, secret\nTOKEN=\n/);
  assert.ok(!text.includes("hunter2"));
  assert.match(text, /MODE=dev/);
  assert.match(text, /enum: dev \| prod/);
});

test("names that exist on every object are not variables", () => {
  assert.throws(() => defineEnv({ constructor: { type: "string" } }, { source: {} }), /constructor: is required but missing/);
  assert.throws(() => defineEnv({ toString: {} }, { source: {} }), EnvError);
  assert.deepEqual({ ...defineEnv({ valueOf: { optional: true } }, { source: {} }) }, { valueOf: undefined });
  const env = defineEnv({ ["__proto__"]: { type: "list", default: ["x"] }, A: {} }, { source: { A: "1" } });
  assert.equal(Object.getPrototypeOf(env), Object.prototype);
  assert.deepEqual(Object.keys(env), ["__proto__", "A"]);
});

test("integers must be safe integers, numbers must be plain decimals", () => {
  assert.throws(() => defineEnv({ I: { type: "integer" } }, { source: { I: "99999999999999999999" } }), /whole number that fits/);
  assert.equal(defineEnv({ I: { type: "integer" } }, { source: { I: "9007199254740991" } }).I, 9007199254740991);
  for (const bad of ["0x10", "0b11", "0o7", "Infinity", "1e999", "1 2", "--1", "."]) {
    assert.throws(() => defineEnv({ N: { type: "number" } }, { source: { N: bad } }), /must be a number/, bad);
  }
  for (const [raw, value] of [["1e3", 1000], [" 5 ", 5], ["-.5", -0.5], ["+2.", 2], ["0", 0]]) {
    assert.equal(defineEnv({ N: { type: "number" } }, { source: { N: raw } }).N, value, raw);
  }
});

test("a pattern with the g flag gives the same answer every time", () => {
  const schema = { CODE: { pattern: /^ab$/g } };
  for (let i = 0; i < 4; i++) assert.equal(defineEnv(schema, { source: { CODE: "ab" } }).CODE, "ab");
});

test("a null entry in the schema is a clear error", () => {
  assert.throws(() => defineEnv({ A: null }, { source: {} }), (e) => e instanceof TypeError && /A needs a description object/.test(e.message));
});

test("exampleEnv cannot be made to write extra variables or broken lines", () => {
  const text = exampleEnv({
    A: { description: "first line\nINJECTED=1", default: "x" },
    B: { default: "two words # not a comment" },
    C: { default: "it's\nbroken" },
    D: { default: "plain/value:1" }
  });
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines, ["A=x", "B='two words # not a comment'", "C=", "D=plain/value:1"]);
});

test("a secret value never appears in any error message, whatever the type", () => {
  const cases = [
    [{ type: "number", min: 10 }, "0.7654321"],
    [{ type: "number", max: 1 }, "98765.4321"],
    [{ type: "number" }, "hunter2-secret"],
    [{ type: "integer" }, "hunter2-secret"],
    [{ type: "integer", min: 99999999 }, "1234567"],
    [{ type: "integer", max: 1 }, "1234567"],
    [{ type: "integer" }, "123456789012345678901234567890"],
    [{ type: "port" }, "123456"],
    [{ type: "enum", values: ["a", "b"] }, "hunter2-secret"],
    [{ type: "url" }, "hunter2-secret"],
    [{ type: "url", protocols: ["https"] }, "ftp://user:hunter2@host/"],
    [{ type: "string", minLength: 99 }, "hunter2-secret"],
    [{ type: "string", pattern: /^x$/ }, "hunter2-secret"],
    [{ type: "boolean" }, "hunter2-secret"]
  ];
  for (const [spec, value] of cases) {
    let message = "";
    try {
      defineEnv({ S: { ...spec, secret: true } }, { source: { S: value } });
    } catch (error) {
      message = error.message;
    }
    assert.notEqual(message, "", `${JSON.stringify(spec)} should have failed`);
    for (const piece of ["hunter2", "7654321", "98765", "1234567", "123456"]) assert.ok(!message.includes(piece), `${spec.type} leaked ${piece}: ${message}`);
  }
});

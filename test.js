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

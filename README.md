# @sandsoftwaresolutions/env-guard

[![CI](https://github.com/SandSoftwareSolutions/ss-env-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-env-guard/actions/workflows/ci.yml)

Check your environment variables once, at startup. You get a typed object, every problem in one message (not one at a time), and secrets never end up in an error message or a log. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/env-guard
```

## Usage

```js
import { defineEnv } from "@sandsoftwaresolutions/env-guard";

export const env = defineEnv({
  PORT:           { type: "port", default: 3000 },
  DATABASE_URL:   { type: "url", protocols: ["postgres", "postgresql"] },
  SESSION_SECRET: { type: "string", secret: true, minLength: 32 },
  LOG_LEVEL:      { type: "enum", values: ["debug", "info", "warn"], default: "info" },
  ORIGINS:        { type: "list", default: [] },
  SENTRY_DSN:     { type: "url", optional: true }
});

env.PORT;       // number
env.LOG_LEVEL;  // "debug" | "info" | "warn"
env.SENTRY_DSN; // string | undefined
```

When something is wrong the app stops at once and says everything that is wrong:

```
EnvError: Invalid environment:
  - DATABASE_URL: is required but missing
  - PORT: must be a port between 1 and 65535, got 70000
  - SESSION_SECRET: must be at least 32 characters
```

## A `.env.example` that cannot go out of date

```js
import { writeFileSync } from "node:fs";
import { exampleEnv } from "@sandsoftwaresolutions/env-guard";

writeFileSync(".env.example", exampleEnv(schema));
```

Descriptions (`description: "..."`), whether a value is required, the type and the default are written for you. Defaults of `secret` variables are left out.

## Types

`string`, `number`, `integer`, `boolean` (true/false, 1/0, yes/no, on/off), `port`, `url`, `enum`, `list` (comma separated). Options: `default`, `optional`, `secret`, `description`, `minLength`, `pattern`, `min`, `max`, `protocols`, `values`.

## Good to know

- An empty variable counts as missing, which is what you want with Docker and `.env` files.
- A `default` is used as it is and not validated.
- `defineEnv(schema, { source })` reads from `source` instead of `process.env`, handy in tests.
- A mistake in the schema itself (unknown type, enum without values, an entry that is not an object) throws a `TypeError` right away.
- `number` takes plain decimals (`3`, `-0.5`, `1e3`); `0x10`, `0b11` and `Infinity` are refused. `integer` and `port` must be safe integers.
- Only variables that exist in `source` itself count: a schema name such as `constructor` or `toString` is not found on the object's prototype.
- A secret never appears in an error message, for any type (this is tested for every message that could show the value).
- `exampleEnv` writes defaults that contain spaces or `#` in single quotes, leaves out a default that has a line break or a `'`, and turns a line break in a `description` into more comment lines.

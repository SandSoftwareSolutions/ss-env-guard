export type EnvKind = "string" | "number" | "integer" | "boolean" | "port" | "url" | "enum" | "list";

export interface EnvSpec {
  type?: EnvKind;
  /** Used when the variable is missing or empty. Not validated. */
  default?: unknown;
  /** Allow the variable to be missing; the value is then `undefined`. */
  optional?: boolean;
  /** Keep the value out of error messages and out of `exampleEnv`. */
  secret?: boolean;
  description?: string;
  minLength?: number;
  pattern?: RegExp;
  min?: number;
  max?: number;
  /** For `url`: allowed protocols without the colon, for example `["http", "https"]`. */
  protocols?: readonly string[];
  /** For `enum`. */
  values?: readonly string[];
}

export type EnvSchema = Record<string, EnvSpec>;

type ValueOf<S> = S extends { type: "number" | "integer" | "port" }
  ? number
  : S extends { type: "boolean" }
    ? boolean
    : S extends { type: "list" }
      ? string[]
      : S extends { type: "enum"; values: readonly (infer V)[] }
        ? V
        : string;

type Resolved<S> = S extends { default: unknown } ? ValueOf<S> : S extends { optional: true } ? ValueOf<S> | undefined : ValueOf<S>;

export type Env<T extends EnvSchema> = Readonly<{ [K in keyof T]: Resolved<T[K]> }>;

export interface EnvProblem {
  name: string;
  message: string;
}

export class EnvError extends Error {
  readonly problems: EnvProblem[];
  constructor(problems: EnvProblem[]);
}

export function defineEnv<const T extends EnvSchema>(schema: T, options?: { source?: Record<string, string | undefined> }): Env<T>;
export function exampleEnv(schema: EnvSchema): string;

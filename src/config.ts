import { homedir } from "node:os";
import { join, parse } from "node:path";
import { ConfigError } from "./errors.js";

export type DocmostConfig = {
  baseUrl: string;
  email?: string;
  password?: string;
  authToken?: string;
  sessionPath: string;
  readOnly: boolean;
};

export type TransportMode = "stdio" | "http";

export type HttpConfig = {
  host: string;
  port: number;
  pathSecret: string;
  allowedHosts?: string[];
  sessionIdleMs: number;
};

type Env = Record<string, string | undefined>;

export const MIN_PATH_SECRET_LENGTH = 32;
const PATH_SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

function required(name: string, env: Env = process.env): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, env: Env = process.env): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function optionalFlag(name: string, env: Env = process.env): boolean {
  const value = env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function optionalInteger(
  name: string,
  fallback: number,
  min: number,
  max: number,
  env: Env,
): number {
  const raw = optional(name, env);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function loadConfig(): DocmostConfig {
  const rawUrl = required("DOCMOST_URL").replace(/\/+$/, "");
  const baseUrl = rawUrl.replace(/\/api$/i, "");
  const email = optional("DOCMOST_EMAIL");
  const password = optional("DOCMOST_PASSWORD");
  const authToken = optional("DOCMOST_AUTH_TOKEN");

  if (!authToken && (!email || !password)) {
    throw new ConfigError(
      "Set DOCMOST_EMAIL and DOCMOST_PASSWORD, or DOCMOST_AUTH_TOKEN",
    );
  }

  return {
    baseUrl,
    email,
    password,
    authToken,
    sessionPath:
      optional("DOCMOST_SESSION_PATH") ??
      join(homedir(), ".docmost-community-mcp", "session.json"),
    readOnly: optionalFlag("DOCMOST_READ_ONLY"),
  };
}

export function loadTransportMode(env: Env = process.env): TransportMode {
  const value = optional("MCP_TRANSPORT", env)?.toLowerCase() ?? "stdio";
  if (value !== "stdio" && value !== "http") {
    throw new ConfigError("MCP_TRANSPORT must be stdio or http");
  }
  return value;
}

export function loadHttpConfig(env: Env = process.env): HttpConfig {
  const pathSecret = optional("MCP_PATH_SECRET", env);
  // Error messages never include the secret itself.
  if (!pathSecret) {
    throw new ConfigError("MCP_PATH_SECRET is required when MCP_TRANSPORT=http");
  }
  if (pathSecret.length < MIN_PATH_SECRET_LENGTH) {
    throw new ConfigError(
      `MCP_PATH_SECRET must be at least ${MIN_PATH_SECRET_LENGTH} characters`,
    );
  }
  if (!PATH_SECRET_PATTERN.test(pathSecret)) {
    throw new ConfigError(
      "MCP_PATH_SECRET may contain only letters, digits, '-' and '_'",
    );
  }

  const allowedHosts = optional("MCP_ALLOWED_HOSTS", env)
    ?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);

  return {
    host: optional("MCP_HTTP_HOST", env) ?? "127.0.0.1",
    port: optionalInteger("MCP_HTTP_PORT", 3001, 1, 65535, env),
    pathSecret,
    allowedHosts: allowedHosts && allowedHosts.length > 0 ? allowedHosts : undefined,
    sessionIdleMs:
      optionalInteger("MCP_SESSION_IDLE_MINUTES", 30, 1, 1440, env) * 60_000,
  };
}

const ACTOR_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function actorVariable(name: string, suffix: "EMAIL" | "PASSWORD"): string {
  return `DOCMOST_ACTOR_${name.toUpperCase().replace(/-/g, "_")}_${suffix}`;
}

function actorSessionPath(sessionPath: string, name: string): string {
  const { dir, name: stem, ext } = parse(sessionPath);
  return join(dir, `${stem}.${name}${ext || ".json"}`);
}

/**
 * Named actors from DOCMOST_ACTORS (comma list) with DOCMOST_ACTOR_<NAME>_EMAIL and
 * DOCMOST_ACTOR_<NAME>_PASSWORD each. Returns an empty map when DOCMOST_ACTORS is unset.
 * Error messages name variables, never their values.
 */
export function loadActorConfigs(
  base: DocmostConfig,
  env: Env = process.env,
): Map<string, DocmostConfig> {
  const actors = new Map<string, DocmostConfig>();
  const raw = optional("DOCMOST_ACTORS", env);
  if (!raw) {
    return actors;
  }

  // Validate every name first, so a typo is reported before missing credentials.
  const names: string[] = [];
  for (const entry of raw.split(",")) {
    const name = entry.trim().toLowerCase();
    if (!name) {
      continue;
    }
    if (!ACTOR_NAME_PATTERN.test(name)) {
      throw new ConfigError(
        `DOCMOST_ACTORS: "${name}" is not a valid actor name (lowercase letters, digits and '-', starting with a letter)`,
      );
    }
    if (names.includes(name)) {
      throw new ConfigError(`DOCMOST_ACTORS lists "${name}" twice`);
    }
    names.push(name);
  }

  for (const name of names) {
    const email = optional(actorVariable(name, "EMAIL"), env);
    const password = optional(actorVariable(name, "PASSWORD"), env);
    if (!email || !password) {
      throw new ConfigError(
        `Actor "${name}" needs ${actorVariable(name, "EMAIL")} and ${actorVariable(name, "PASSWORD")}`,
      );
    }
    actors.set(name, {
      baseUrl: base.baseUrl,
      email,
      password,
      sessionPath: actorSessionPath(base.sessionPath, name),
      readOnly: base.readOnly,
    });
  }
  return actors;
}

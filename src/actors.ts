import { DocmostClient } from "./client.js";
import type { DocmostConfig } from "./config.js";
import { ConfigError } from "./errors.js";

/**
 * Docmost clients by role: one default client for reads (and for writes when no
 * actors are defined), plus one client per named actor, created on first use.
 *
 * Actors are attribution, not authentication: the server cannot tell which model
 * is calling, so any caller can name any actor.
 */
export class ClientRegistry {
  private readonly actorClients = new Map<string, DocmostClient>();

  constructor(
    readonly reader: DocmostClient,
    private readonly actorConfigs: ReadonlyMap<string, DocmostConfig> = new Map(),
  ) {}

  get actorNames(): string[] {
    return [...this.actorConfigs.keys()];
  }

  forWrite(actor: unknown): DocmostClient {
    if (this.actorConfigs.size === 0) {
      return this.reader;
    }
    const name = typeof actor === "string" ? actor.trim().toLowerCase() : "";
    const config = this.actorConfigs.get(name);
    if (!config) {
      throw new ConfigError(
        `${name ? `Unknown actor "${name}"` : "Missing actor"}. Pass actor as one of: ${this.actorNames.join(", ")}. Nothing was written.`,
      );
    }
    let client = this.actorClients.get(name);
    if (!client) {
      client = new DocmostClient(config);
      this.actorClients.set(name, client);
    }
    return client;
  }
}

import { bootstrap } from "./bootstrap.js";
import { wire } from "./composition.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const deps = wire(config);
  const server = await bootstrap(deps, { host: config.host, port: config.port });
  registerShutdownHooks(server.shutdown);
  server.fastify.log.info(
    { dataDir: config.dataDir, host: config.host, port: config.port, slaMs: config.slaMs },
    "shield-eval listening",
  );
}

function registerShutdownHooks(shutdown: () => Promise<void>): void {
  const handler = async (): Promise<void> => {
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

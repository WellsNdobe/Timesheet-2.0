import { app } from "./app.js";
import { env } from "./config.js";
import { getPool } from "./db/client.js";

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});

const shutdown = () => {
  server.close(() => {
    void getPool().end().finally(() => process.exit(0));
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

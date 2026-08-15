import { httpServerHandler } from "cloudflare:node";
import { env as workerEnv } from "cloudflare:workers";
import { createApp } from "./app.js";

const port = 3000;
const app = createApp({ databaseConnectionString: () => workerEnv.HYPERDRIVE.connectionString });
app.listen(port);

export default httpServerHandler({ port });

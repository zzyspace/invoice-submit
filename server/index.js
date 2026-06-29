import { serverHost, serverPort } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(serverPort, serverHost, () => {
  console.log(`invoice-submit server listening on http://${serverHost}:${serverPort}`);
});

// Entry file for managed Node hosts that ask for one (Hostinger Web App,
// cPanel/Passenger, etc.). Equivalent to `next start`. Docker/VPS users can
// keep using `npm start`. Shared verbatim with every generated site.
const { createServer } = require("node:http");
const next = require("next");

const port = parseInt(process.env.PORT || "3000", 10);
// Not HOSTNAME: some Linux hosts set that to the machine name, which is not bindable.
const host = process.env.HOST || "0.0.0.0";

const app = next({ dev: false, hostname: host, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(port, host, () => {
      console.log(`Ready on http://${host}:${port}`);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

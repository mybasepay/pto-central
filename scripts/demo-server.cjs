const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "/demo") pathname = "/index.html";
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) return send(res, 403, "forbidden");
  fs.readFile(file, (err, body) => {
    if (err) return send(res, 404, "not found");
    send(res, 200, body, types[path.extname(file)] || "application/octet-stream");
  });
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/index.html?demo=1`;
  console.log("PTO Central Corporate Light demo");
  console.log(`Open: ${url}`);
  console.log("Synthetic data only. No SharePoint, emails, calendars, Power Automate, or processors.");
});

const http = require('http');
const path = require('path');
const fs = require('fs');

const port = process.env.PORT ? Number(process.env.PORT) : 4173;
const root = path.resolve(__dirname, '..');

const mimeLookup = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) {
      sendNotFound(res);
      return;
    }
    const type = mimeLookup[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function resolvePath(urlPath = '/') {
  const cleanPath = path.normalize(urlPath.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  return path.join(root, cleanPath);
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    sendNotFound(res);
    return;
  }

  const candidate = resolvePath(req.url);

  if (!candidate.startsWith(root)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid path');
    return;
  }

  fs.stat(candidate, (statErr, stats) => {
    if (statErr) {
      sendNotFound(res);
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(candidate, 'index.html');
      fs.access(indexPath, fs.constants.R_OK, accessErr => {
        if (accessErr) {
          sendNotFound(res);
        } else {
          serveFile(indexPath, res);
        }
      });
      return;
    }

    serveFile(candidate, res);
  });
});

server.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
});

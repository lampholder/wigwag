// A "little server" for running wigwag.html over http://localhost instead
// of opening it as a raw file:// path. Some browser APIs -- notably
// Notification, which the mention-notifications feature (tracker issue
// #65) depends on -- are unavailable to file:// origins with no way to
// grant permission at all, even though the same page works fine served
// locally. This doesn't build or transform anything; it's the same
// zero-dependency static file server tests/static-server.js already uses
// for the test suite, just rooted at the repo and defaulting to a
// different port so the two can run at the same time without colliding.
//
// Usage: npm run serve  (then open http://localhost:8933/)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = parseInt(process.env.PORT || '8933', 10);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jsonl': 'application/octet-stream' };

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/wigwag.html';
  const filePath = path.join(root, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log('wigwag serving at http://localhost:' + port + '/'));

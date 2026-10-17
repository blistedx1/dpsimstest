require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const dataHandler = require('./api/data.js');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // Route API requests
  if (pathname.startsWith('/api/data')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (body) {
        try {
          req.body = JSON.parse(body);
        } catch (e) {
          req.body = {};
        }
      }
      
      // Adapt res for express/vercel style
      const originalEnd = res.end.bind(res);
      res.status = function(code) {
        res.statusCode = code;
        return res;
      };
      res.json = function(data) {
        res.setHeader('Content-Type', 'application/json');
        return originalEnd(JSON.stringify(data));
      };

      dataHandler(req, res);
    });
    return;
  }

  // Serve static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': contentType };
    if (pathname === '/sw.js') {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Connected to Neon PostgreSQL database via /api/data`);
});

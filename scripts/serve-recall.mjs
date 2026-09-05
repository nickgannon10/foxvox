import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import console from 'node:console';

const root = path.resolve('dist-recall-chrome');
const contentTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = path.resolve(
      root,
      '.' + decodeURIComponent(url.pathname === '/' ? '/demo.html' : url.pathname)
    );
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    const body = await fs.readFile(file);
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found. Run npm run build:recall first.');
  }
});
server.listen(4173, '127.0.0.1', () =>
  console.log('Recall preview: http://127.0.0.1:4173/demo.html (sample cards; no Anki writes)')
);

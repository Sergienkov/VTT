import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? process.env.PORT ?? 8082);
const host = process.env.HOST ?? '127.0.0.1';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const requestedPath = resolve(root, `.${decodeURIComponent(url.pathname)}`);

    if (!requestedPath.startsWith(root + sep) && requestedPath !== root) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const filePath = await resolveFilePath(requestedPath, request.headers.accept ?? '');
    const extension = extname(filePath);
    const headers = {
      'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };

    if (filePath.endsWith('service-worker.js')) {
      headers['Cache-Control'] = 'no-cache';
    }

    response.writeHead(200, headers);
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://localhost:${port}`);
});

async function resolveFilePath(requestedPath, acceptHeader) {
  const found = await existingFile(requestedPath);
  if (found) return found;

  const indexInDirectory = await existingFile(join(requestedPath, 'index.html'));
  if (indexInDirectory) return indexInDirectory;

  if (acceptHeader.includes('text/html')) {
    return join(root, 'index.html');
  }

  const error = new Error('Not found');
  error.code = 'ENOENT';
  throw error;
}

async function existingFile(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

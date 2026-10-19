import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { handleCall } from './flow.js';

function same(a, b) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function createServer({ secret = '', production = false } = {}) {
  if (production && !/^[A-Za-z0-9_-]{24,}$/.test(secret)) {
    throw new Error('Production requires IVR_PATH_SECRET with at least 24 URL-safe characters');
  }
  const endpoint = secret ? '/ivr/' + secret : '/ivr';
  return http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => {
      res.writeHead(status);
      res.end(JSON.stringify(body));
    };
    try {
      if ((req.url ?? '').length > 8192) return send(414, { type: 'hangup' });
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz' && req.method === 'GET') return send(200, { status: 'ok' });
      if (!same(url.pathname, endpoint)) return send(404, { type: 'hangup' });
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return send(405, { type: 'hangup' });
      }
      const params = Object.create(null);
      for (const [key, value] of url.searchParams) {
        if (Object.hasOwn(params, key)) return send(400, { type: 'hangup' });
        params[key] = value;
      }
      return send(200, handleCall(params));
    } catch {
      // Never log request URLs or financial/caller data.
      return send(500, { type: 'hangup' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer({
    secret: process.env.IVR_PATH_SECRET || '',
    production: process.env.NODE_ENV === 'production'
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(port, '0.0.0.0', () => console.log('IVR server listening on port ' + port));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

// Tiny static server for the level (fetch('hero.json') needs http, not file://).
// index.html is written like the published page body (it starts at <title>), so it is served inside the same document skeleton
// the artifact host wraps it in (doctype, charset, viewport). Usage: node level/tools/serve.mjs [port=8123]  -> http://localhost:8123/
// Also imported by playtest.mjs: serve(dir, port) -> Promise<{ url, close }>.
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';
export function serve(dir, port = 0){
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
    if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end('not found'); return; }
    let body = fs.readFileSync(f); const ext = path.extname(f);
    if (path.basename(f) === 'index.html') body = HEAD + body + '\n</body></html>';
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(body);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)){
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  serve(dir, +(process.argv[2] || 8123)).then(s => console.log('level at', s.url));
}

import { cpSync, createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assetKey, assets, fingerprints, init, localPath, publicCatalog, root, slug, validate } from './lab-core.mjs';

const legacyFiles = ['index.html', 'lab.js', 'oxygen-glass-models.js', 'styles.css', 'favicon.svg', '.nojekyll'];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const copy = (name, dest) => {
  const to = resolve(dest, name);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(localPath(name), to, { recursive: true });
};

export function build() {
  const { projects } = publicCatalog();
  const catalog = assets();
  const dest = localPath('dist');
  if (existsSync(dest)) {
    if (dest !== resolve(root, 'dist') || lstatSync(dest).isSymbolicLink()) throw new Error('Invalid dist directory');
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(dest);
  for (const name of [...legacyFiles, 'vendor', 'platform']) copy(name, dest);
  const used = new Set(projects.filter(p => p.kind === 'config').flatMap(p => validate(p.id).assets));
  const publicAssets = catalog.filter(a => used.has(assetKey(a.id, a.version))).map(({ source, provenance, ...a }) => a);
  mkdirSync(resolve(dest, 'assets'));
  writeFileSync(resolve(dest, 'assets/catalog.json'), `${JSON.stringify({ schemaVersion: 1, assets: publicAssets }, null, 2)}\n`);
  for (const { model, preview } of publicAssets) {
    copy(model, dest);
    copy(preview, dest);
  }
  for (const p of projects) {
    if (p.kind === 'config') copy(`experiments/${p.id}/experiment.json`, dest);
    if (p.thumbnail) copy(p.thumbnail, dest);
  }
  return dest;
}

export function serve({ base = root, port = 8000 } = {}) {
  const server = createServer((request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
      const path = new URL(request.url, 'http://127.0.0.1').pathname.slice(1);
      const name = path.endsWith('/') || !path ? `${path}index.html` : path;
      const extension = extname(name);
      const experimental = /^experiments\/[a-z0-9-]+\/experiment\.json$/.test(name);
      const publicPath = legacyFiles.includes(name) || /^(platform|vendor|assets)\//.test(name) || experimental;
      if (!types[extension] || !publicPath) { response.writeHead(404).end('Not found'); return; }
      const file = localPath(name, base);
      if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': types[extension], 'Cache-Control': 'no-store' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

async function main([verb, arg, extra]) {
  switch (verb) {
    case 'init': console.log(init(arg).join('\n')); break;
    case 'validate': console.log(JSON.stringify(validate(arg), null, 2)); break;
    case 'fingerprints': console.log(JSON.stringify(fingerprints(arg), null, 2)); break;
    case 'list-assets': console.log(JSON.stringify(assets(), null, 2)); break;
    case 'check': {
      const { projects } = publicCatalog();
      const folder = resolve(root, 'experiments');
      const ids = existsSync(folder) ? readdirSync(folder, { withFileTypes: true }).filter(x => x.isDirectory() && slug.test(x.name)).map(x => x.name) : [];
      for (const id of ids) console.log(JSON.stringify(validate(id)));
      console.log(`${projects.length} catalog entries; ${ids.length} experiment configurations checked`);
      break;
    }
    case 'build': console.log(build()); break;
    case 'serve': {
      const dist = arg === '--dist' || extra === '--dist';
      const rawPort = arg === '--dist' ? extra : arg;
      const port = rawPort === undefined ? 8000 : Number(rawPort);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Expected a valid port');
      const base = dist ? resolve(root, 'dist') : root;
      if (dist && !existsSync(base)) throw new Error('Run npm run build before serving dist');
      const server = await serve({ base, port });
      console.log(`http://127.0.0.1:${server.address().port}/platform/`);
      break;
    }
    default: throw new Error('Usage: npm run lab -- init|validate|fingerprints <id>; list-assets|check|build; serve [port] [--dist]');
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}

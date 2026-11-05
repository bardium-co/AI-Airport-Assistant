// Builds dist/netlify-upload.zip — a ready-to-upload package for Netlify's drag-and-drop deploy.
//   npm run build:netlify
// Everything is pre-built: the website files sit at the top level, the API is ONE bundled function file with the
// language packs baked in, so Netlify has nothing to install or compile.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const site = path.join(dist, 'netlify-upload');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'netlify', 'functions'), { recursive: true });

// 1. website files
fs.cpSync(path.join(root, 'public'), site, { recursive: true });

// 2. the API function, bundled, with the language packs embedded (no files to find at run time)
const packs = fs.readdirSync(path.join(root, 'public', 'lang')).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(root, 'public', 'lang', f), 'utf8')));
await build({
  entryPoints: [path.join(root, 'netlify', 'functions', 'api.mjs')],
  outfile: path.join(site, 'netlify', 'functions', 'api.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: false, legalComments: 'none', logLevel: 'warning',
  banner: { js: `globalThis.__AA_PACKS__ = ${JSON.stringify(packs)};` },
});

// 3. host settings that a drag-and-drop deploy reads from files
fs.writeFileSync(path.join(site, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: microphone=(self), camera=(), geolocation=(), payment=(), usb=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
/sw.js
  Cache-Control: no-cache
`);
fs.writeFileSync(path.join(site, 'netlify.toml'), `[functions]\n  node_bundler = "none"\n\n[build.environment]\n  NODE_VERSION = "22"\n`);

// 4. zip (Windows 10+, macOS and Linux all ship a tar that can write zip files)
const zip = path.join(dist, 'netlify-upload.zip');
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar'; // Windows' own bsdtar writes zip files; Git's GNU tar does not
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', site, '.'], { stdio: 'inherit' });
console.log(`\nCreated ${zip} (${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`);

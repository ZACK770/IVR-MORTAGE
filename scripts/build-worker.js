import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const flow = readFileSync(new URL('../src/flow.js', import.meta.url), 'utf8').replaceAll('export function ', 'function ');
const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').replace("import { handleCall } from './flow.js';", '');
const target = new URL('../dist/', import.meta.url);
mkdirSync(target, { recursive: true });
writeFileSync(new URL('worker.js', target), flow + '\n' + worker);
console.log('Built dist/worker.js for the Cloudflare dashboard');

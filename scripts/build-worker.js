import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const flow = readFileSync(new URL('../src/flow.js', import.meta.url), 'utf8').replaceAll('export function ', 'function ');
const logger = readFileSync(new URL('../src/logger.js', import.meta.url), 'utf8').replaceAll('export function ', 'function ');
const submissions = readFileSync(new URL('../src/submissions.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replaceAll('export function ', 'function ')
  .replaceAll('export async function ', 'async function ');
const email = readFileSync(new URL('../src/email.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ');
const sheets = readFileSync(new URL('../src/google-sheets.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export const ', 'const ').replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ').replace('export class GoogleSheetsClient', 'class GoogleSheetsClient');
const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').replace(/^(import .*|export \{ SheetsWriter \}.*);\r?\n/gm, '');
const target = new URL('../dist/', import.meta.url);
mkdirSync(target, { recursive: true });
writeFileSync(new URL('worker.js', target), flow + '\n' + logger + '\n' + submissions + '\n' + email + '\n' + sheets + '\n' + worker);
console.log('Built dist/worker.js for the Cloudflare dashboard');

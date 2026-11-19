// Generate once per build, before instances start. Keep this module in the
// server bundle only. An operator-supplied runtime secret takes precedence.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { config } from '../src/config.js';

const directory = new URL('../.turingpot/', import.meta.url);
mkdirSync(directory, { recursive: true, mode: 0o700 });
// Only this child directory is served as static content.
const publicDirectory = new URL('public/', directory);
mkdirSync(publicDirectory, { recursive: true });
const template = readFileSync(new URL('../templates/index.html', import.meta.url), 'utf8');
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const html = template.replace(/\{\{(\w+)\}\}/g, (_, field) =>
  config[field].replace(/[&<>"']/g, character => entities[character]));
writeFileSync(new URL('index.html', publicDirectory), html);
const target = new URL('build-key.js', directory);
if (process.argv.includes('--if-missing') && existsSync(target)) process.exit(0);
const temporary = new URL(randomUUID(), directory);
const key = randomBytes(32).toString('hex');
writeFileSync(temporary, 'export default "' + key + '";\n', { mode: 0o600, flag: 'wx' });
renameSync(temporary, target);

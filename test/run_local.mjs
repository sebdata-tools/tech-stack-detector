// Live smoke test: runs the Actor locally with a given input and prints what it saved, one line per detection.
// Usage (from the Actor folder): node test/run_local.mjs @file.json [brief]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2] ?? '{"websites":["https://wordpress.org","https://www.allbirds.com"]}';
const input = JSON.parse(arg.startsWith('@') ? fs.readFileSync(arg.slice(1), 'utf8').replace(/^﻿/, '') : arg);
const brief = process.argv[3] === 'brief';

const storage = path.join(root, 'storage');
fs.rmSync(storage, { recursive: true, force: true });
const kv = path.join(storage, 'key_value_stores', 'default');
fs.mkdirSync(kv, { recursive: true });
fs.writeFileSync(path.join(kv, 'INPUT.json'), JSON.stringify(input));

const t0 = Date.now();
const run = spawnSync(process.execPath, ['src/main.js'], { cwd: root, stdio: 'inherit', env: { ...process.env, APIFY_LOCAL_STORAGE_DIR: storage } });
const seconds = ((Date.now() - t0) / 1000).toFixed(1);

const dsDir = path.join(storage, 'datasets', 'default');
const files = fs.existsSync(dsDir) ? fs.readdirSync(dsDir).filter((f) => /^\d+\.json$/.test(f)).sort() : [];
const items = files.map((f) => JSON.parse(fs.readFileSync(path.join(dsDir, f), 'utf8')));

for (const it of items) {
    console.log(`\n## ${it.website} -> ${it.finalUrl} [${it.statusCode}]${it.blocked ? ` BLOCKED (${it.blockedReason})` : ''}: ${it.technologyCount} technologies`);
    if (brief) console.log(`   ${it.technologies.map((t) => t.name + (t.version ? ` ${t.version}` : '') + (t.confidence === 'medium' ? '?' : '')).join(', ')}`);
    else for (const t of it.technologies) console.log(`   ${t.category.padEnd(22)} ${(t.name + (t.version ? ` ${t.version}` : '')).padEnd(30)} ${t.confidence.padEnd(6)} ${t.evidence}`);
}
const summaryFile = path.join(kv, 'SUMMARY.json');
const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
if (summary) {
    console.log('\nSUMMARY', JSON.stringify({ ...summary, siteReport: undefined }));
    for (const r of summary.siteReport.filter((s) => s.status !== 'ok')) console.log(`   ${r.status.padEnd(12)} ${r.input}: ${r.message}`);
}
console.log('\n=== exit code', run.status, '| seconds', seconds, '| rows', items.length, '| charged', summary?.rowsCharged, '| blocked rows', items.filter((i) => i.blocked).length,
    '| rows without evidence', items.filter((i) => i.technologies.some((t) => !t.evidence)).length, '| detections', items.reduce((n, i) => n + i.technologyCount, 0));
fs.writeFileSync(path.join(storage, 'items.json'), JSON.stringify(items, null, 1));
process.exit(run.status ?? 1);

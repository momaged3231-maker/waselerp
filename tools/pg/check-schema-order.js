/*
 * Checks that every FOREIGN KEY in the schema points at a table that is
 * created earlier in the same file — the mistake that breaks a fresh
 * database but goes unnoticed on an existing one.
 *
 *   node tools/pg/check-schema-order.js
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', 'db', 'schema.postgres.sql');
const sql = fs.readFileSync(file, 'utf8');

const created = [];
const problems = [];

const createRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)/gi;
const alterRe = /ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+\w+\s+[^,;]*?REFERENCES\s+(\w+)/gi;

let match;
const lines = sql.split(/\r?\n/);
let offset = 0;
const lineOf = (index) => sql.slice(0, index).split(/\r?\n/).length;

while ((match = createRe.exec(sql))) {
  const table = match[1];
  const start = match.index;
  const end = sql.indexOf(');', start);
  const body = sql.slice(start, end);
  created.push(table);
  const refRe = /REFERENCES\s+(\w+)\s*\(/gi;
  let ref;
  while ((ref = refRe.exec(body))) {
    const target = ref[1];
    if (target === table) continue;
    if (!created.includes(target)) {
      problems.push(`"${table}" (line ${lineOf(start)}) references "${target}" before it is created`);
    }
  }
  offset = end;
}

// ALTER TABLE ... ADD COLUMN ... REFERENCES
while ((match = alterRe.exec(sql))) {
  const [, table, target] = match;
  if (!created.includes(target)) {
    problems.push(`ALTER "${table}" (line ${lineOf(match.index)}) references "${target}" before it is created`);
  }
}

console.log(`tables in schema: ${created.length}`);
if (problems.length) {
  console.log('\n❌ ORDERING PROBLEMS:');
  for (const problem of problems) console.log('  - ' + problem);
  process.exit(1);
}
console.log('✅ every foreign key points at an earlier table');

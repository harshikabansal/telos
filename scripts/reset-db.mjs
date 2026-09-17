#!/usr/bin/env node
/**
 * Deletes the local database so the next start begins from an empty schema.
 * Only ever touches the configured data directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import config from '../server/config.js';

const targets = [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`];
const present = targets.filter((file) => fs.existsSync(file));

if (!present.length) {
  console.log('No database found. Nothing to reset.');
  process.exit(0);
}

if (!process.argv.includes('--yes')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This permanently deletes ${config.dbFile} and every account in it.\nType RESET to continue: `
  );
  rl.close();
  if (answer.trim() !== 'RESET') {
    console.log('Cancelled. Nothing was deleted.');
    process.exit(0);
  }
}

for (const file of present) fs.rmSync(file, { force: true });
console.log(`Deleted ${present.length} file(s). The next start will create a fresh database.`);

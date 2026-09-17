#!/usr/bin/env node
/**
 * Static verification of the browser bundle.
 *
 * The client is served as native ES modules with no build step, so nothing
 * catches a typo in an import path or a syntax error before the browser does.
 * This script parses every module, resolves each specifier against the file
 * system, and reports anything that would fail at load time.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'public', 'js');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(CLIENT);

let failures = 0;
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

// 1. Syntax
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failures += 1;
    console.error(`SYNTAX  ${rel(file)}\n${error.stderr?.toString().split('\n').slice(0, 6).join('\n')}`);
  }
}

// 2. Import specifiers resolve to real files
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const specifiers = new Set();
  for (const match of source.matchAll(IMPORT_RE)) specifiers.add(match[1]);
  for (const match of source.matchAll(DYNAMIC_RE)) specifiers.add(match[1]);

  for (const specifier of specifiers) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      failures += 1;
      console.error(`BARE    ${rel(file)} imports "${specifier}" — the browser cannot resolve bare specifiers.`);
      continue;
    }
    const target = specifier.startsWith('/')
      ? path.join(ROOT, 'public', specifier)
      : path.resolve(path.dirname(file), specifier);
    if (!fs.existsSync(target)) {
      failures += 1;
      console.error(`MISSING ${rel(file)} imports "${specifier}" → ${rel(target)} does not exist.`);
    }
  }
}

// 3. Named exports referenced by other modules actually exist
const exportsOf = (source) => {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(source)) names.add('default');
  return names;
};

const exportCache = new Map();
const exportsFor = (file) => {
  if (!exportCache.has(file)) exportCache.set(file, exportsOf(fs.readFileSync(file, 'utf8')));
  return exportCache.get(file);
};

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const namedImport = /import\s+(?:([A-Za-z0-9_$]+)\s*,\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(namedImport)) {
    const specifier = match[3];
    if (!specifier.startsWith('.')) continue;
    const target = path.resolve(path.dirname(file), specifier);
    if (!fs.existsSync(target)) continue;
    const available = exportsFor(target);
    for (const part of match[2].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (!name) continue;
      if (!available.has(name)) {
        failures += 1;
        console.error(`EXPORT  ${rel(file)} imports { ${name} } from "${specifier}" — not exported by ${rel(target)}.`);
      }
    }
  }
}

if (failures) {
  console.error(`\n${failures} client problem${failures === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log(`Client modules OK — ${files.length} files parsed, all imports resolve.`);

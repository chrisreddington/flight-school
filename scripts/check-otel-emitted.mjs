#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const [, , inputPathArg, ...requiredServiceNamesArg] = process.argv;

if (!inputPathArg) {
  console.error(
    'Usage: node scripts/check-otel-emitted.mjs <trace-export-file> [required-service ...]\n' +
      'Example: node scripts/check-otel-emitted.mjs traces.json flight-school-web flight-school-worker',
  );
  process.exit(2);
}

const requiredServiceNames = requiredServiceNamesArg.length
  ? requiredServiceNamesArg
  : ['flight-school-web', 'flight-school-worker'];

function extractStringValue(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.stringValue === 'string') return value.stringValue;
  return null;
}

function collectServiceNamesFromAttributes(attributes, foundNames) {
  if (!Array.isArray(attributes)) return;
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== 'object') continue;
    if (attribute.key !== 'service.name') continue;
    const serviceName = extractStringValue(attribute.value);
    if (serviceName) foundNames.add(serviceName);
  }
}

function walk(value, foundNames) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, foundNames);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  if (typeof value['service.name'] === 'string') {
    foundNames.add(value['service.name']);
  }
  if (typeof value.serviceName === 'string') {
    foundNames.add(value.serviceName);
  }

  collectServiceNamesFromAttributes(value.attributes, foundNames);
  for (const nestedValue of Object.values(value)) {
    walk(nestedValue, foundNames);
  }
}

function parseInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return [JSON.parse(trimmed)];
  }

  const documents = [];
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    documents.push(JSON.parse(line));
  }
  return documents;
}

try {
  const inputPath = path.resolve(process.cwd(), inputPathArg);
  const raw = readFileSync(inputPath, 'utf8');
  const documents = parseInput(raw);
  const foundServiceNames = new Set();
  for (const document of documents) {
    walk(document, foundServiceNames);
  }

  const missing = requiredServiceNames.filter((name) => !foundServiceNames.has(name));
  if (missing.length > 0) {
    console.error(
      `OTel emitted check failed. Missing service.name values: ${missing.join(', ')}. ` +
        `Found: ${Array.from(foundServiceNames).sort().join(', ') || '(none)'}`,
    );
    process.exit(1);
  }

  console.log(
    `OTel emitted check passed. Found service.name values: ${Array.from(foundServiceNames).sort().join(', ')}`,
  );
} catch (error) {
  console.error('OTel emitted check failed with an error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { APP_LANGUAGES } from '../../client/src/config/languages';
import { SUPPORTED_LANGUAGES } from '../../src/i18n/languages';

const LOCALES_DIR = import.meta.dir;
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const codes = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => path.basename(f, '.json'))
  .sort();

function load(code: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));
}

/** Flattens nested JSON to dotted paths mapped to leaf values. */
function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}) {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = obj;
  }
  return out;
}

const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, '');
const baseKeys = (flat: Record<string, unknown>) => new Set(Object.keys(flat).map(baseKey));

function placeholders(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set([...value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]))].sort();
}

const en = flatten(load('en'));
const enKeys = baseKeys(en);

// Base keys that are plural in en.json, mapped to their en `_other` form.
const enPlural = new Map<string, string>();
for (const key of Object.keys(en)) {
  if (PLURAL_SUFFIX.test(key)) enPlural.set(baseKey(key), `${baseKey(key)}_other`);
}

function requiredCategories(code: string): string[] {
  const rules = new Intl.PluralRules(code);
  const set = new Set<string>();
  for (let n = 0; n <= 1000; n++) set.add(rules.select(n));
  return [...set].sort();
}

describe('locale files', () => {
  test('locale files match the renderer and main-process language lists', () => {
    expect(codes).toEqual([...APP_LANGUAGES.map((l) => l.code)].sort());
    expect(codes).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  describe.each(codes)('%s', (code) => {
    const flat = flatten(load(code));

    test(`${code} has the same keys as en`, () => {
      const keys = baseKeys(flat);
      const missing = [...enKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !enKeys.has(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    test(`${code} has every plural form its language needs`, () => {
      const categories = requiredCategories(code);
      const missing: string[] = [];
      for (const base of enPlural.keys()) {
        for (const cat of categories) {
          const value = flat[`${base}_${cat}`];
          if (typeof value !== 'string' || value.trim() === '') missing.push(`${base}_${cat}`);
        }
      }
      expect(missing).toEqual([]);
    });

    test(`${code} keeps en's placeholders`, () => {
      const mismatched: string[] = [];
      for (const key of Object.keys(en)) {
        const base = baseKey(key);
        if (PLURAL_SUFFIX.test(key)) {
          if (key !== enPlural.get(base)) continue;
          const expected = placeholders(en[key]);
          for (const cat of requiredCategories(code)) {
            const got = placeholders(flat[`${base}_${cat}`]);
            if (flat[`${base}_${cat}`] !== undefined && got.join() !== expected.join())
              mismatched.push(`${base}_${cat}: ${got} != ${expected}`);
          }
        } else if (placeholders(flat[key]).join() !== placeholders(en[key]).join()) {
          mismatched.push(key);
        }
      }
      expect(mismatched).toEqual([]);
    });
  });
});

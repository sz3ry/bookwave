import { describe, expect, test } from 'bun:test';
import { createTtlCache } from './cache';

describe('createTtlCache', () => {
  test('hits before the ttl and misses at it', () => {
    let clock = 1000;
    const cache = createTtlCache<string>(3_600_000, () => clock);
    cache.set('k', 'v');
    clock += 3_599_999;
    expect(cache.get('k')).toBe('v');
    clock += 1;
    expect(cache.get('k')).toBeUndefined();
  });
});

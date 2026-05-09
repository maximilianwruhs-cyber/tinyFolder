/**
 * lru_map.ts — bounded insertion-order map with LRU eviction.
 *
 * JavaScript's `Map` already preserves insertion order, so the hottest path
 * for an LRU just needs (a) a `max` cap and (b) a `get`/`set` that bumps the
 * accessed key to the back. Used by `api_server.ts` to bound `taskRegistry`
 * so a long-running daemon with heavy API traffic doesn't grow forever.
 *
 * Single-user safe defaults: max=1000 ≈ a few hundred KB at typical task sizes.
 */

export class LruMap<K, V> {
  private readonly store = new Map<K, V>();

  constructor(public readonly max: number) {
    if (!Number.isFinite(max) || max < 1) {
      throw new Error(`LruMap: max must be >= 1 (got ${max})`);
    }
  }

  get size(): number {
    return this.store.size;
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  /**
   * Read the value for `key`, refreshing its position so it survives the next
   * eviction wave. Returns undefined if absent.
   */
  get(key: K): V | undefined {
    const v = this.store.get(key);
    if (v === undefined) return undefined;
    // Re-insert to bump to the most-recently-used end.
    this.store.delete(key);
    this.store.set(key, v);
    return v;
  }

  /**
   * Insert/overwrite. If at capacity, evicts the least-recently-used entry.
   */
  set(key: K, value: V): this {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.max) {
      // Drop the oldest (first-inserted, least-recently-used).
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest as K);
    }
    this.store.set(key, value);
    return this;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): IterableIterator<K> {
    return this.store.keys();
  }
}

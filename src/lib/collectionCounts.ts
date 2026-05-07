export function sumMapSizes<K, V extends { size: number }>(m: Map<K, V>): number {
  return Array.from(m.values()).reduce((sum, inner) => sum + inner.size, 0);
}

export function sumMapArrayLengths<K, V>(m: Map<K, V[]>): number {
  return Array.from(m.values()).reduce((sum, arr) => sum + arr.length, 0);
}

export function sumMapSetSizes<K, V>(m: Map<K, Set<V>>): number {
  return Array.from(m.values()).reduce((sum, set) => sum + set.size, 0);
}

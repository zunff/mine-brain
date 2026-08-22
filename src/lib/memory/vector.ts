/** 向量余弦相似度。两个向量必须同维度；否则返回 0（视为无关，不让跨空间向量污染打分）。 */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 余弦得分映射到与现有信号可比的数量级（约 0~~2，作为第 5 条信号）。 */
export function vectorBoost(a: Float32Array | number[], b: Float32Array | number[]): number {
  const c = cosine(a, b);
  if (c <= 0) return 0;
  return c * 2;
}

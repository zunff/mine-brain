import { describe, expect, it } from "vitest";
import { cosine, vectorBoost } from "@/lib/memory/vector";

describe("cosine 余弦相似度", () => {
  it("同一向量相似度为 1", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it("正交向量为 0", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("方向相同大小不同仍为 1（余弦只看方向）", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1, 6);
  });

  it("维度不同返回 0（跨空间向量不比较）", () => {
    expect(cosine([1, 0, 0], [1, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it("零向量返回 0，不产生 NaN", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("vectorBoost 映射到信号量级", () => {
  it("正相似度按余弦×2 放大，负相似度归零", () => {
    expect(vectorBoost([1, 0], [1, 0])).toBeCloseTo(2, 4);
    expect(vectorBoost([1, 0], [0, 1])).toBe(0);
    expect(vectorBoost([1, 0], [0, 0])).toBe(0);
  });
});

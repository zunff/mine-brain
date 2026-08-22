import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const KEY = /EMBED_API_KEY=(.*)/.exec(readFileSync(".env.local", "utf8"))[1].trim();
const BASE = /EMBED_BASE_URL=(.*)/.exec(readFileSync(".env.local", "utf8"))[1].trim();
const MODEL = /EMBED_MODEL=(.*)/.exec(readFileSync(".env.local", "utf8"))[1].trim();
const DIMS = Number(/EMBED_DIMENSIONS=(.*)/.exec(readFileSync(".env.local", "utf8"))[1].trim());

const db = new DatabaseSync("data/mine-brain.db", { readOnly: true });

// 1) 原始向量内容核查
const rows = db.prepare(`
  SELECT e.memory_id, e.model, e.dims, e.vector, m.type, substr(m.content,1,50) content
  FROM memory_embeddings e JOIN memories m ON m.id = e.memory_id
`).all();
console.log(`=== 存储核查: ${rows.length} 条向量, model=${rows[0]?.model}, dims=${rows[0]?.dims} ===`);
const v0 = new Float32Array(rows[0].vector.buffer.slice(rows[0].vector.byteOffset, rows[0].vector.byteOffset + rows[0].vector.byteLength));
function stats(v) {
  let sum=0, sq=0, mx=0;
  for (const x of v) { sum+=x; sq+=x*x; mx=Math.max(mx,Math.abs(x)); }
  const mean=sum/v.length, sd=Math.sqrt(sq/v.length - mean*mean);
  return {mean:+mean.toFixed(4), sd:+sd.toFixed(4), maxAbs:+mx.toFixed(4)};
}
console.log("第一条向量统计:", stats(v0), "(sd>0 且 ~0.02~0.2 之间=正常嵌入向量，不是全零/常量)");
console.log("前 6 个浮点值:", [...v0.slice(0,6)].map(x=>+x.toFixed(4)).join(", "));

// 2) 语义远近核查（分块嵌入）
async function embed(texts) {
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, input: texts, encoding_format: "float", dimensions: DIMS }),
  });
  if (!res.ok) throw new Error(`embed ${res.status} ${await res.text()}`);
  const d = await res.json();
  return d.data.map(x => new Float32Array(x.embedding));
}
function cosine(a,b){
  if(a.length!==b.length) return 0;
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
  return dot/(Math.sqrt(na)*Math.sqrt(nb));
}

const queries = ["我在想跳槽换工作的事", "明天晚饭吃什么比较好"];
const [qWork, qFood] = await embed(queries);
const store = rows.map(r => ({
  content: r.content,
  vec: new Float32Array(r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.vector.byteLength)),
}));

// 3) 检索核查：向量通道能否召回在词法上最相关的记忆
const workRanked = store.map(s=>({c:s.content, s:cosine(qWork,s.vec)})).sort((a,b)=>b.s-a.s);
const foodRanked = store.map(s=>({c:s.content, s:cosine(qFood,s.vec)})).sort((a,b)=>b.s-a.s);
console.log("\n=== 查询「我在想跳槽换工作的事」top3 ===");
workRanked.slice(0,3).forEach(x=>console.log(`  ${x.s.toFixed(3)}  ${x.c}`));
console.log("=== 查询「明天晚饭吃什么」top3 ===");
foodRanked.slice(0,3).forEach(x=>console.log(`  ${x.s.toFixed(3)}  ${x.c}`));

// 4) 词法匹配不到的语义召回演示：换个「换环境」说法
const [qEnv] = await embed(["我想换个环境重新开始"]);
const envRanked = store.map(s=>({c:s.content, s:cosine(qEnv,s.vec)})).sort((a,b)=>b.s-a.s);
console.log("\n=== 语义召回（换种说法）「我想换个环境重新开始」top3 ===");
envRanked.slice(0,3).forEach(x=>console.log(`  ${x.s.toFixed(3)}  ${x.c}`));

// ローカル確認用の作り物データ。実データではない。`npm run seed:dev` で .wrangler のローカル D1/R2 に入れる。
import { writeFileSync } from "node:fs";
const city = "99999", sql = [], feats = [];
sql.push("DELETE FROM recipe_results; DELETE FROM area_values; DELETE FROM facilities; DELETE FROM areas; DELETE FROM snapshots;");
sql.push("INSERT INTO snapshots(snapshot_id,layer_id,scope,fetched_at,source_url,row_count) VALUES (1,'pop_total','dev','2026-01-01','dev',0),(2,'pop_65','dev','2026-01-01','dev',0),(3,'pop_75','dev','2026-01-01','dev',0),(4,'elev','dev','2026-01-01','dev',0);");
let n = 0;
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
  const code = `99999${String(++n).padStart(6, "0")}`, lng = 135.0 + j * 0.006, lat = 34.70 + i * 0.005;
  const elev = 5 + i * 9, p75 = n % 7 === 0 ? "NULL" : 40 + ((n * 37) % 260);
  sql.push(`INSERT INTO areas VALUES ('${code}','99','${city}','テスト市','テスト町${n}丁目',${lat},${lng});`);
  sql.push(`INSERT INTO area_values VALUES ('${code}','pop_total',1,${p75 === "NULL" ? "NULL" : p75 * 6}),('${code}','pop_65',2,${p75 === "NULL" ? "NULL" : p75 * 2}),('${code}','pop_75',3,${p75}),('${code}','elev',4,${elev});`);
  const w = 0.003, h = 0.0025;
  feats.push({ type: "Feature", properties: { code, name: `テスト町${n}丁目` }, geometry: { type: "MultiPolygon", coordinates: [[[[lng - w, lat - h], [lng - w, lat + h], [lng + w, lat + h], [lng + w, lat - h], [lng - w, lat - h]]]] } });
}
sql.push("INSERT INTO facilities VALUES ('pharmacy','d1','テスト薬局A','テスト市1','99','99999',34.701,135.001,6,'2026-01-01','2026-01-01'),('pharmacy','d2','テスト薬局B','テスト市2','99','99999',34.712,135.020,25,'2026-01-01','2026-01-01');");
writeFileSync(".wrangler-seed.sql", sql.join("\n"));
writeFileSync(".wrangler-seed.geojson", JSON.stringify({ type: "FeatureCollection", features: feats }));
console.log("areas", n);

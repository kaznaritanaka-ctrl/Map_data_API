// 取り込み処理。取得元の URL は wrangler.jsonc の vars で差し替えられる。
import { unzipSync, strFromU8 } from "fflate";
import iconv from "iconv-lite";
import { parseBoundaryZip, toGeoJson } from "./parsers/boundary";
import { parseEstatAgeCsv } from "./parsers/estatAge";
import { parsePharmacyCsv } from "./parsers/pharmacy";
import { parseDemTile } from "./parsers/demTile";
import { tilePixel } from "./geo";
import { computeReach, RECIPE_ID } from "./recipe";
import type { Env } from "./index";

const UA = { "user-agent": "map-data-api (personal research; contact via GitHub kaznaritanaka-ctrl/Map_data_API)" };
const today = () => new Date().toISOString().slice(0, 10);

async function get(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** D1 の1文あたりのパラメータ上限に収まるよう、複数行 INSERT を分割して流す */
async function bulk(db: D1Database, head: string, tail: string, rows: unknown[][], perStmt = 20) {
  if (!rows.length) return;
  const width = rows[0].length;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += perStmt) {
    const chunk = rows.slice(i, i + perStmt);
    const ph = chunk.map(() => `(${Array(width).fill("?").join(",")})`).join(",");
    stmts.push(db.prepare(`${head} VALUES ${ph} ${tail}`).bind(...chunk.flat()));
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

async function snapshot(db: D1Database, layer: string, scope: string, url: string, r2Key: string | null, rows: number): Promise<number> {
  const r = await db.prepare("INSERT INTO snapshots(layer_id,scope,fetched_at,source_url,r2_key,row_count) VALUES (?,?,?,?,?,?) RETURNING snapshot_id")
    .bind(layer, scope, new Date().toISOString(), url, r2Key, rows).first<{ snapshot_id: number }>();
  return r!.snapshot_id;
}

/** 境界：市区町村ごとの Shapefile を取り、町丁目の表と表示用 GeoJSON を作る */
export async function ingestBoundary(env: Env, city: string) {
  const url = env.ESTAT_BOUNDARY_URL.replace("{city}", city);
  const zip = await get(url);
  const rawKey = `raw/boundary/${city}/${today()}.zip`;
  await env.BUCKET.put(rawKey, zip);
  const all = parseBoundaryZip(zip);
  // HCODE 8154 は水面。KIGO_E が E2 以降は同じ町丁目の飛び地で、人口は E1 側に載っている
  const land = all.filter((a) => a.hcode !== "8154" && a.key_code);
  const primary = land.filter((a) => !/^E([2-9]|\d\d)/.test(a.kigo_e));
  const rows = primary.map((a) => [a.key_code, a.pref, a.pref + a.city, a.city_name, a.name, a.lat, a.lng]);
  await bulk(env.DB, "INSERT INTO areas(area_code,pref_code,city_code,city_name,name,rep_lat,rep_lng)",
    "ON CONFLICT(area_code) DO UPDATE SET city_name=excluded.city_name,name=excluded.name,rep_lat=excluded.rep_lat,rep_lng=excluded.rep_lng", rows, 14);
  await env.BUCKET.put(`geojson/${city}.json`, JSON.stringify(toGeoJson(land)), { httpMetadata: { contentType: "application/geo+json" } });
  await snapshot(env.DB, "boundary", city, url, rawKey, primary.length);
  return { city, areas: primary.length, polygons: land.length, water_skipped: all.length - land.length };
}

/** 年齢別人口：都道府県単位の CSV。取り込み済みの町丁目に対応する行だけ使う */
export async function ingestAge(env: Env, pref: string) {
  const url = env.ESTAT_AGE_URL.replace("{pref}", pref);
  const zip = await get(url);
  const rawKey = `raw/age/${pref}/${today()}.zip`;
  await env.BUCKET.put(rawKey, zip);
  const files = unzipSync(zip);
  const name = Object.keys(files).find((n) => /\.(txt|csv)$/i.test(n));
  if (!name) throw new Error("年齢zip: txt/csv がありません");
  const parsed = parseEstatAgeCsv(iconv.decode(Buffer.from(files[name]), "Shift_JIS"));
  const known = new Set((await env.DB.prepare("SELECT area_code FROM areas WHERE pref_code=?").bind(pref).all<{ area_code: string }>()).results.map((r) => r.area_code));
  const hit = parsed.filter((r) => known.has(r.area_code));
  const sid = { t: await snapshot(env.DB, "pop_total", pref, url, rawKey, hit.length), a: await snapshot(env.DB, "pop_65", pref, url, rawKey, hit.length), b: await snapshot(env.DB, "pop_75", pref, url, rawKey, hit.length) };
  const rows: unknown[][] = [];
  for (const r of hit) rows.push([r.area_code, "pop_total", sid.t, r.total], [r.area_code, "pop_65", sid.a, r.p65], [r.area_code, "pop_75", sid.b, r.p75]);
  await bulk(env.DB, "INSERT OR REPLACE INTO area_values(area_code,layer_id,snapshot_id,value)", "", rows, 24);
  return { pref, csv_rows: parsed.length, matched: hit.length, areas_without_data: known.size - hit.length, suppressed_75: hit.filter((r) => r.p75 == null).length };
}

/** 薬局：全国 CSV の zip。公表のたびにファイル名が変わるので URL は呼び出し時に渡す */
export async function ingestPharmacy(env: Env, pref: string, url: string) {
  const zip = await get(url);
  const rawKey = `raw/pharmacy/${today()}.zip`;
  await env.BUCKET.put(rawKey, zip);
  const files = unzipSync(zip);
  const name = Object.keys(files).find((n) => /\.csv$/i.test(n));
  if (!name) throw new Error("薬局zip: csv がありません");
  const { rows, skipped } = parsePharmacyCsv(strFromU8(files[name]), pref);
  const d = today();
  await bulk(env.DB, "INSERT INTO facilities(type,facility_id,name,address,pref_code,city_code,lat,lng,first_seen,last_seen)",
    "ON CONFLICT(type,facility_id) DO UPDATE SET name=excluded.name,address=excluded.address,lat=excluded.lat,lng=excluded.lng,last_seen=excluded.last_seen",
    rows.map((r) => ["pharmacy", r.id, r.name, r.address, r.pref_code, r.city_code, r.lat, r.lng, d, d]), 10);
  await snapshot(env.DB, "pharmacy", pref, url, rawKey, rows.length);
  return { pref, pharmacies: rows.length, skipped_no_coords: skipped };
}

/** 標高：町丁目の代表点と施設の位置に、標高タイル（z14）の値を付ける */
export async function ingestElevation(env: Env, pref: string) {
  const Z = 14;
  const cache = new Map<string, (number | null)[][] | null>();
  const elevAt = async (lat: number, lng: number): Promise<number | null> => {
    const t = tilePixel(lat, lng, Z);
    const k = `${t.x}/${t.y}`;
    if (!cache.has(k)) {
      const res = await fetch(env.GSI_DEM_URL.replace("{z}", String(Z)).replace("{x}", String(t.x)).replace("{y}", String(t.y)), { headers: UA });
      cache.set(k, res.ok ? parseDemTile(await res.text()) : null); // 404 は海域などデータなし
    }
    return cache.get(k)?.[t.py]?.[t.px] ?? null;
  };
  const areas = (await env.DB.prepare("SELECT area_code,rep_lat,rep_lng FROM areas WHERE pref_code=?").bind(pref).all<{ area_code: string; rep_lat: number; rep_lng: number }>()).results;
  const sid = await snapshot(env.DB, "elev", pref, env.GSI_DEM_URL, null, areas.length);
  const rows: unknown[][] = [];
  let missing = 0;
  for (const a of areas) { const e = await elevAt(a.rep_lat, a.rep_lng); if (e == null) missing++; rows.push([a.area_code, "elev", sid, e]); }
  await bulk(env.DB, "INSERT OR REPLACE INTO area_values(area_code,layer_id,snapshot_id,value)", "", rows, 24);
  const facs = (await env.DB.prepare("SELECT type,facility_id,lat,lng FROM facilities WHERE pref_code=?").bind(pref).all<{ type: string; facility_id: string; lat: number; lng: number }>()).results;
  const ups: D1PreparedStatement[] = [];
  for (const f of facs) ups.push(env.DB.prepare("UPDATE facilities SET elev_m=? WHERE type=? AND facility_id=?").bind(await elevAt(f.lat, f.lng), f.type, f.facility_id));
  for (let i = 0; i < ups.length; i += 50) await env.DB.batch(ups.slice(i, i + 50));
  return { pref, areas: areas.length, areas_without_elev: missing, facilities: facs.length, tiles: cache.size };
}

/** 最新スナップショットの値を引く副問い合わせ */
export const latest = (layer: string) =>
  `(SELECT v.value FROM area_values v WHERE v.area_code=a.area_code AND v.layer_id='${layer}' ORDER BY v.snapshot_id DESC LIMIT 1)`;

/** レシピ計算：町丁目ごとの最寄り施設・距離・標高差を保存する */
export async function runRecipe(env: Env, pref: string) {
  const areas = (await env.DB.prepare(`SELECT a.area_code id, a.rep_lat lat, a.rep_lng lng, ${latest("elev")} elev FROM areas a WHERE a.pref_code=?`).bind(pref).all<{ id: string; lat: number; lng: number; elev: number | null }>()).results;
  // 県境の向こうの施設が最寄りになることがあるので、施設は都道府県で絞らない
  const facs = (await env.DB.prepare("SELECT facility_id id, lat, lng, elev_m elev FROM facilities WHERE type='pharmacy'").all<{ id: string; lat: number; lng: number; elev: number | null }>()).results;
  const reach = computeReach(areas, facs);
  const now = new Date().toISOString();
  await bulk(env.DB, "INSERT OR REPLACE INTO recipe_results(recipe_id,area_code,computed_at,nearest_facility_id,dist_m,elev_diff_m)", "",
    reach.map((r) => [RECIPE_ID, r.area_code, now, r.nearest_facility_id, r.dist_m, r.elev_diff_m]), 16);
  return { pref, areas: areas.length, facilities: facs.length };
}

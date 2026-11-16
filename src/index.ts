import { ingestAge, ingestBoundary, ingestElevation, ingestPharmacy, latest, runRecipe } from "./ingest";
import { DEFAULTS, RECIPE_ID, rank } from "./recipe";

export interface Env {
  DB: D1Database; BUCKET: R2Bucket; ASSETS: Fetcher;
  ESTAT_BOUNDARY_URL: string; ESTAT_AGE_URL: string; GSI_DEM_URL: string;
  ADMIN_TOKEN?: string;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

const AREA_SELECT = `SELECT a.area_code, a.city_code, a.city_name, a.name, a.rep_lat lat, a.rep_lng lng,
  ${latest("pop_total")} pop_total, ${latest("pop_65")} pop_65, ${latest("pop_75")} pop_75, ${latest("elev")} elev,
  r.dist_m, r.elev_diff_m, r.nearest_facility_id
  FROM areas a LEFT JOIN recipe_results r ON r.area_code=a.area_code AND r.recipe_id='${RECIPE_ID}'`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const q = url.searchParams;
    try {
      if (p.startsWith("/admin/")) {
        // ホスト全体は Cloudflare Access で保護する前提。書き込み系はさらにトークンを要求する
        if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return bad("unauthorized", 401);
        if (req.method !== "POST") return bad("POST only", 405);
        const pref = q.get("pref") ?? "", city = q.get("city") ?? "";
        if (p === "/admin/ingest/boundary") return /^\d{5}$/.test(city) ? json(await ingestBoundary(env, city)) : bad("city は5桁");
        if (!/^\d{2}$/.test(pref)) return bad("pref は2桁");
        if (p === "/admin/ingest/age") return json(await ingestAge(env, pref));
        if (p === "/admin/ingest/pharmacy") { const u = q.get("url"); return u && u.startsWith("https://www.mhlw.go.jp/") ? json(await ingestPharmacy(env, pref, u)) : bad("url は厚労省サイトの zip を指定"); }
        if (p === "/admin/ingest/elevation") return json(await ingestElevation(env, pref));
        if (p === "/admin/recipe/" + RECIPE_ID) return json(await runRecipe(env, pref));
        return bad("not found", 404);
      }

      if (p === "/api/layers") return json((await env.DB.prepare("SELECT l.*, (SELECT MAX(fetched_at) FROM snapshots s WHERE s.layer_id=l.layer_id) last_fetched FROM layers l").all()).results);
      if (p === "/api/cities") return json((await env.DB.prepare("SELECT city_code, city_name, COUNT(*) areas FROM areas GROUP BY city_code ORDER BY city_code").all()).results);
      if (p === "/api/areas") {
        const city = q.get("city");
        if (!city || !/^\d{5}$/.test(city)) return bad("city は5桁");
        return json((await env.DB.prepare(`${AREA_SELECT} WHERE a.city_code=?`).bind(city).all()).results);
      }
      if (p === "/api/facilities") {
        const b = (q.get("bbox") ?? "").split(",").map(Number); // west,south,east,north
        if (b.length !== 4 || b.some((v) => !Number.isFinite(v))) return bad("bbox=west,south,east,north");
        return json((await env.DB.prepare("SELECT type,facility_id,name,address,lat,lng,elev_m,first_seen,last_seen FROM facilities WHERE lng BETWEEN ? AND ? AND lat BETWEEN ? AND ? LIMIT 5000").bind(b[0], b[2], b[1], b[3]).all()).results);
      }
      const g = p.match(/^\/api\/geojson\/(\d{5})$/);
      if (g) {
        const o = await env.BUCKET.get(`geojson/${g[1]}.json`);
        return o ? new Response(o.body, { headers: { "content-type": "application/geo+json", "cache-control": "private, max-age=3600" } }) : bad("not found", 404);
      }
      if (p === `/api/recipes/${RECIPE_ID}/top`) {
        const t = { distM: Number(q.get("dist") ?? DEFAULTS.distM), elevM: Number(q.get("elev") ?? DEFAULTS.elevM) };
        const limit = Math.min(200, Number(q.get("limit") ?? 20));
        const cities = (q.get("cities") ?? "").split(",").filter((c) => /^\d{5}$/.test(c));
        if (!cities.length) return bad("cities=28204,28100 のように指定");
        const rows = (await env.DB.prepare(`${AREA_SELECT} WHERE a.city_code IN (${cities.map(() => "?").join(",")})`).bind(...cities).all<any>()).results;
        return json({ thresholds: t, note: "供給点は薬局のみ。ドラッグストア（店舗販売業）は未反映。距離は直線距離。", total_areas: rows.length, results: rank(rows, t, limit) });
      }
      if (p.startsWith("/api/")) return bad("not found", 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return bad(e instanceof Error ? e.message : String(e), 500);
    }
  },
} satisfies ExportedHandler<Env>;

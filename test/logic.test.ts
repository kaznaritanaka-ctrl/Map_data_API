import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import iconv from "iconv-lite";
import { GridIndex, haversine, tilePixel } from "../src/geo";
import { computeReach, isHardToReach, rank } from "../src/recipe";
import { parseCsv } from "../src/parsers/csv";
import { parsePharmacyCsv } from "../src/parsers/pharmacy";
import { parseEstatAgeCsv } from "../src/parsers/estatAge";
import { parseDemTile } from "../src/parsers/demTile";
import { parseBoundaryZip, toGeoJson } from "../src/parsers/boundary";

describe("geo", () => {
  it("haversine: 緯度1度は約111km", () => {
    expect(haversine(34, 135, 35, 135)).toBeGreaterThan(111_000);
    expect(haversine(34, 135, 35, 135)).toBeLessThan(111_400);
  });
  it("GridIndex.nearest は総当たりと一致する", () => {
    let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    const pts = Array.from({ length: 400 }, (_, i) => ({ id: String(i), lat: 34.6 + rnd() * 0.3, lng: 134.9 + rnd() * 0.5 }));
    const idx = new GridIndex(pts);
    for (let k = 0; k < 200; k++) {
      const lat = 34.5 + rnd() * 0.5, lng = 134.8 + rnd() * 0.7;
      const brute = pts.map((p) => ({ p, d: haversine(lat, lng, p.lat, p.lng) })).sort((a, b) => a.d - b.d)[0];
      expect(idx.nearest(lat, lng)!.pt.id).toBe(brute.p.id);
    }
  });
  it("空の索引は null", () => expect(new GridIndex([]).nearest(34, 135)).toBeNull());
  it("tilePixel: 明石市役所付近は z14 の既知タイルに入る", () => {
    const t = tilePixel(34.6431, 134.9972, 14);
    expect(t.x).toBe(Math.floor(((134.9972 + 180) / 360) * 16384));
    expect(t.px).toBeGreaterThanOrEqual(0); expect(t.py).toBeLessThanOrEqual(255);
  });
});

describe("recipe", () => {
  const fac = [{ id: "f1", lat: 34.7, lng: 135.0, elev: 10 }];
  it("距離と標高差を出す", () => {
    const r = computeReach([{ id: "a", lat: 34.7, lng: 135.0109, elev: 45 }], fac)[0];
    expect(r.nearest_facility_id).toBe("f1");
    expect(r.dist_m).toBeGreaterThan(950); expect(r.dist_m).toBeLessThan(1050);
    expect(r.elev_diff_m).toBe(35);
  });
  it("しきい値：遠い、または高低差が大きい", () => {
    expect(isHardToReach({ dist_m: 499, elev_diff_m: 19 })).toBe(false);
    expect(isHardToReach({ dist_m: 500, elev_diff_m: 0 })).toBe(true);
    expect(isHardToReach({ dist_m: 100, elev_diff_m: -20 })).toBe(true);
    expect(isHardToReach({ dist_m: null, elev_diff_m: null })).toBe(false);
  });
  it("75歳以上の多い順。秘匿（null）は除く", () => {
    const rows = [
      { area_code: "1", pop_75: 50, dist_m: 800, elev_diff_m: 0 },
      { area_code: "2", pop_75: 300, dist_m: 100, elev_diff_m: 0 },
      { area_code: "3", pop_75: 200, dist_m: 600, elev_diff_m: 0 },
      { area_code: "4", pop_75: null, dist_m: 900, elev_diff_m: 0 },
    ];
    expect(rank(rows).map((r) => r.area_code)).toEqual(["3", "1"]);
  });
});

describe("parsers", () => {
  it("CSV: 引用符・改行・BOM", () => {
    expect(parseCsv('﻿a,"b,1","c""x"\r\n1,2,"3\n4"\n')).toEqual([["a", "b,1", 'c"x'], ["1", "2", "3\n4"]]);
  });
  it("薬局CSV: 見出しで列を探し、座標の無い行は数えて除く", () => {
    const csv = '﻿"ID","名称","フリガナ","都道府県コード","市区町村コード","所在地","所在地座標（緯度）","所在地座標（経度）"\n' +
      '"p1","あかし薬局","アカシ","28","28203","兵庫県明石市1","34.65","134.99"\n"p2","座標なし","x","28","28203","兵庫県明石市2","",""\n"p3","大阪の薬局","x","27","27100","大阪市","34.69","135.50"\n';
    const r = parsePharmacyCsv(csv, "28");
    expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ id: "p1", lat: 34.65, lng: 134.99, city_code: "28203" });
    expect(r.skipped).toBe(1);
  });
  it("年齢CSV: 項目名で列を探し、秘匿 X は null", () => {
    const csv = "KEY_CODE,HYOSYO,CITYNAME,NAME,HTKSYORI,HTKSAKI,GASSAN,T001082001,T001082002,T001082020,T001082021,T001082022\n" +
      ",,,,,,,総数、年齢「不詳」含む,　総数０～４歳,　総数６５歳以上,　総数７５歳以上,男の総数、年齢「不詳」含む\n" +
      "28203001001,3,明石市,相生町１丁目,,,,500,20,150,80,240\n28203001002,3,明石市,相生町２丁目,,,,X,X,X,X,X\n";
    const r = parseEstatAgeCsv(csv);
    expect(r[0]).toEqual({ area_code: "28203001001", total: 500, p65: 150, p75: 80 });
    expect(r[1].p75).toBeNull();
  });
  it("標高タイル: e は null", () => expect(parseDemTile("1.5,e\n3,4.25\n")).toEqual([[1.5, null], [3, 4.25]]));

  it("境界zip: Shift_JIS の属性とポリゴンを読む", () => {
    // 最小の Shapefile を組み立てる（ポリゴン2件）
    const fields: [string, number][] = [["KEY_CODE", 11], ["PREF", 2], ["CITY", 3], ["CITY_NAME", 20], ["S_NAME", 30], ["KIGO_E", 3], ["HCODE", 4], ["JINKO", 8], ["X_CODE", 12], ["Y_CODE", 12]];
    const recs = [["28203001001", "28", "203", "明石市", "相生町１丁目", "", "8101", "500", "134.99500", "34.65000"], ["28203999999", "28", "203", "明石市", "", "", "8154", "0", "135.00000", "34.60000"]];
    const recLen = 1 + fields.reduce((s, f) => s + f[1], 0), headerLen = 32 + 32 * fields.length + 1;
    const dbf = new Uint8Array(headerLen + recLen * recs.length); const dv = new DataView(dbf.buffer);
    dbf[0] = 3; dv.setUint32(4, recs.length, true); dv.setUint16(8, headerLen, true); dv.setUint16(10, recLen, true);
    fields.forEach(([n, l], i) => { dbf.set(strToU8(n), 32 + 32 * i); dbf[32 + 32 * i + 11] = 67; dbf[32 + 32 * i + 16] = l; });
    dbf[headerLen - 1] = 0x0d;
    recs.forEach((r, ri) => { let p = headerLen + ri * recLen; dbf[p++] = 0x20; r.forEach((v, fi) => { const b = iconv.encode(v, "Shift_JIS"); dbf.fill(0x20, p, p + fields[fi][1]); dbf.set(b, p); p += fields[fi][1]; }); });
    const ring = [[134.99, 34.64], [134.99, 34.66], [135.0, 34.66], [135.0, 34.64], [134.99, 34.64]];
    const one = () => { const b = new Uint8Array(8 + 44 + 4 + 16 * ring.length); const d = new DataView(b.buffer); d.setInt32(4, (b.length - 8) / 2, false); d.setInt32(8, 5, true); d.setInt32(8 + 36, 1, true); d.setInt32(8 + 40, ring.length, true); d.setInt32(8 + 44, 0, true); ring.forEach(([x, y], i) => { d.setFloat64(8 + 48 + 16 * i, x, true); d.setFloat64(8 + 48 + 16 * i + 8, y, true); }); return b; };
    const shp = new Uint8Array(100 + one().length * 2); shp.set(one(), 100); shp.set(one(), 100 + one().length);
    const areas = parseBoundaryZip(zipSync({ "r2ka28203.dbf": dbf, "r2ka28203.shp": shp }));
    expect(areas).toHaveLength(2);
    expect(areas[0]).toMatchObject({ key_code: "28203001001", city_name: "明石市", name: "相生町１丁目", jinko: 500, lat: 34.65, lng: 134.995 });
    expect(areas[0].rings[0]).toHaveLength(5);
    expect(toGeoJson(areas).features[0].properties.code).toBe("28203001001");
  });
});

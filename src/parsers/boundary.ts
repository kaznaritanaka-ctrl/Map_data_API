// e-Stat 小地域境界データ（Shapefile を zip にしたもの）を読む。
// 属性(.dbf)は Shift_JIS。図形(.shp)はポリゴン(type 5)のみ扱う。
import { unzipSync } from "fflate";
import iconv from "iconv-lite";

export interface BoundaryArea {
  key_code: string; pref: string; city: string; city_name: string; name: string;
  hcode: string; kigo_e: string; jinko: number | null; lng: number; lat: number;
  rings: number[][][]; // [ring][point][lng,lat]
}

export function parseDbf(buf: Uint8Array): Record<string, string>[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(4, true), headerLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
  const fields: { name: string; len: number }[] = [];
  for (let off = 32; off < headerLen - 1 && buf[off] !== 0x0d; off += 32) {
    let name = "";
    for (let i = 0; i < 11 && buf[off + i] !== 0; i++) name += String.fromCharCode(buf[off + i]);
    fields.push({ name, len: buf[off + 16] });
  }
  const out: Record<string, string>[] = [];
  for (let r = 0; r < n; r++) {
    let p = headerLen + r * recLen + 1; // 先頭1バイトは削除フラグ
    const rec: Record<string, string> = {};
    for (const f of fields) { rec[f.name] = iconv.decode(Buffer.from(buf.subarray(p, p + f.len)), "Shift_JIS").trim(); p += f.len; }
    out.push(rec);
  }
  return out;
}

export function parseShpPolygons(buf: Uint8Array): number[][][][] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const shapes: number[][][][] = [];
  let off = 100;
  while (off + 8 <= buf.byteLength) {
    const contentLen = dv.getInt32(off + 4, false) * 2;
    const s = off + 8;
    const type = dv.getInt32(s, true);
    if (type === 5 || type === 15) {
      const numParts = dv.getInt32(s + 36, true), numPoints = dv.getInt32(s + 40, true);
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(dv.getInt32(s + 44 + 4 * i, true));
      const pts0 = s + 44 + 4 * numParts;
      const rings: number[][][] = [];
      for (let i = 0; i < numParts; i++) {
        const end = i + 1 < numParts ? parts[i + 1] : numPoints;
        const ring: number[][] = [];
        for (let k = parts[i]; k < end; k++) {
          // 小数5桁（約1m）に丸め、連続する同一点は落とす
          const x = Math.round(dv.getFloat64(pts0 + 16 * k, true) * 1e5) / 1e5;
          const y = Math.round(dv.getFloat64(pts0 + 16 * k + 8, true) * 1e5) / 1e5;
          const last = ring[ring.length - 1];
          if (!last || last[0] !== x || last[1] !== y) ring.push([x, y]);
        }
        if (ring.length >= 4) rings.push(ring);
      }
      shapes.push(rings);
    } else shapes.push([]); // Null shape など
    off = s + contentLen;
  }
  return shapes;
}

export function parseBoundaryZip(zip: Uint8Array): BoundaryArea[] {
  const files = unzipSync(zip);
  const pick = (ext: string) => { const k = Object.keys(files).find((n) => n.toLowerCase().endsWith(ext)); if (!k) throw new Error(`境界zip: ${ext} がありません`); return files[k]; };
  const recs = parseDbf(pick(".dbf"));
  const shapes = parseShpPolygons(pick(".shp"));
  if (recs.length !== shapes.length) throw new Error(`境界zip: 属性 ${recs.length} 件と図形 ${shapes.length} 件が一致しません`);
  return recs.map((r, i) => ({
    key_code: r.KEY_CODE, pref: r.PREF, city: r.CITY, city_name: r.CITY_NAME, name: r.S_NAME,
    hcode: r.HCODE, kigo_e: r.KIGO_E, jinko: r.JINKO === "" ? null : Number(r.JINKO),
    lng: Number(r.X_CODE), lat: Number(r.Y_CODE), rings: shapes[i],
  }));
}

/** 地図表示用の GeoJSON。同じ KEY_CODE の飛び地はそのまま別フィーチャーで持つ */
export function toGeoJson(areas: BoundaryArea[]) {
  return {
    type: "FeatureCollection",
    features: areas.filter((a) => a.rings.length).map((a) => ({
      type: "Feature",
      properties: { code: a.key_code, name: a.name },
      // Shapefile は外周と穴を区別せず並べる。表示用途なので 1リング=1ポリゴンとして出す
      geometry: { type: "MultiPolygon", coordinates: a.rings.map((r) => [r]) },
    })),
  };
}

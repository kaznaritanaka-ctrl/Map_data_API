// 医療情報ネット オープンデータ（薬局）の CSV。UTF-8 BOM つき。
// 列は見出しの文字で探す（公表時点で列順が変わっても壊れにくくするため）。
import { parseCsv } from "./csv";

export interface PharmacyRow { id: string; name: string; address: string; pref_code: string; city_code: string; lat: number; lng: number }

const norm = (s: string) => s.replace(/[（(]/g, "(").replace(/[）)]/g, ")").replace(/\s/g, "");

export function parsePharmacyCsv(text: string, prefCode?: string): { rows: PharmacyRow[]; skipped: number } {
  const t = parseCsv(text);
  if (t.length < 2) throw new Error("薬局CSV: 行がありません");
  const head = t[0].map(norm);
  const find = (...cands: ((h: string) => boolean)[]) => { for (const f of cands) { const i = head.findIndex(f); if (i >= 0) return i; } return -1; };
  const col = {
    id: find((h) => h === "ID"),
    name: find((h) => h === "名称", (h) => h === "正式名称"),
    address: find((h) => h === "所在地"),
    pref: find((h) => h === "都道府県コード"),
    city: find((h) => h === "市区町村コード"),
    lat: find((h) => h.includes("緯度")),
    lng: find((h) => h.includes("経度")),
  };
  for (const [k, v] of Object.entries(col)) if (v < 0) throw new Error(`薬局CSV: 列が見つかりません: ${k}（見出し: ${t[0].slice(0, 15).join("|")}）`);
  const rows: PharmacyRow[] = [];
  let skipped = 0;
  for (const r of t.slice(1)) {
    if (r.length < head.length - 2) continue;
    const pref = (r[col.pref] ?? "").padStart(2, "0");
    if (prefCode && pref !== prefCode) continue;
    const lat = Number(r[col.lat]), lng = Number(r[col.lng]);
    // 座標が空・日本の範囲外の行は距離計算に使えないので数えて除く
    if (!r[col.lat] || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 46 || lng < 122 || lng > 154) { skipped++; continue; }
    rows.push({ id: r[col.id], name: r[col.name], address: r[col.address], pref_code: pref, city_code: r[col.city], lat, lng });
  }
  return { rows, skipped };
}

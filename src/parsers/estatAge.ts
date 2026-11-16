// e-Stat 統計GIS「年齢（5歳階級、4区分）別、男女別人口」(T001082) の CSV。Shift_JIS。
// 1行目が項目コード、2行目が日本語の項目名。使う列は項目名で探す。
// 秘匿は "X"、該当なしは "-"。どちらも null にする。
import { parseCsv } from "./csv";

export interface AgeRow { area_code: string; total: number | null; p65: number | null; p75: number | null }

const z2h = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[\s　]/g, "");
const num = (s: string | undefined) => { if (s == null) return null; const v = s.trim(); if (v === "" || v === "X" || v === "-" || v === "x") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

export function parseEstatAgeCsv(text: string): AgeRow[] {
  const t = parseCsv(text);
  if (t.length < 3) throw new Error("年齢CSV: 行が足りません");
  const codes = t[0], labels = t[1].map(z2h);
  const key = codes.indexOf("KEY_CODE");
  if (key < 0) throw new Error("年齢CSV: KEY_CODE 列がありません");
  // 「総数」で始まる列のうち、男女別でないもの
  const pick = (re: RegExp) => labels.findIndex((l) => l.startsWith("総数") && re.test(l));
  const total = labels.findIndex((l) => l.startsWith("総数") && l.includes("不詳"));
  const p65 = pick(/65歳以上/), p75 = pick(/75歳以上/);
  if (total < 0 || p65 < 0 || p75 < 0) throw new Error(`年齢CSV: 列が見つかりません total=${total} 65=${p65} 75=${p75}`);
  return t.slice(2).filter((r) => r[key]).map((r) => ({ area_code: r[key], total: num(r[total]), p65: num(r[p65]), p75: num(r[p75]) }));
}

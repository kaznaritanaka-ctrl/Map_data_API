// レシピ第1号：受渡店舗の候補地（uketashi-v1）
// 行きにくさ ＝ 最寄りの供給点まで distM 以上、または標高差 elevM 以上。
// 行きにくい町丁目を 75歳以上人口の多い順に並べる。

import { GridIndex, type Pt } from "./geo";

export const RECIPE_ID = "uketashi-v1";
export const DEFAULTS = { distM: 500, elevM: 20 };

export interface AreaIn extends Pt { elev: number | null }
export interface FacilityIn extends Pt { elev: number | null }

export interface Reach {
  area_code: string;
  nearest_facility_id: string | null;
  dist_m: number | null;
  elev_diff_m: number | null;
}

/** 町丁目ごとに、最寄り施設・距離・標高差を求める（しきい値は適用しない） */
export function computeReach(areas: AreaIn[], facilities: FacilityIn[]): Reach[] {
  const idx = new GridIndex(facilities);
  return areas.map((a) => {
    const n = idx.nearest(a.lat, a.lng);
    if (!n) return { area_code: a.id, nearest_facility_id: null, dist_m: null, elev_diff_m: null };
    const diff = a.elev != null && n.pt.elev != null ? a.elev - n.pt.elev : null;
    return { area_code: a.id, nearest_facility_id: n.pt.id, dist_m: Math.round(n.dist), elev_diff_m: diff == null ? null : Math.round(diff * 10) / 10 };
  });
}

/** 行きにくいか。標高差は上り下りどちらも負担なので絶対値で見る。値が無い側は判定に使わない */
export function isHardToReach(r: { dist_m: number | null; elev_diff_m: number | null }, t = DEFAULTS): boolean {
  const far = r.dist_m != null && r.dist_m >= t.distM;
  const steep = r.elev_diff_m != null && Math.abs(r.elev_diff_m) >= t.elevM;
  return far || steep;
}

export interface Ranked { area_code: string; pop_75: number | null; dist_m: number | null; elev_diff_m: number | null }

/** 行きにくい町丁目を 75歳以上人口の降順に。人口が秘匿・欠損の町丁目は除く */
export function rank<T extends Ranked>(rows: T[], t = DEFAULTS, limit = 20): T[] {
  return rows
    .filter((r) => r.pop_75 != null && isHardToReach(r, t))
    .sort((a, b) => (b.pop_75! - a.pop_75!) || a.area_code.localeCompare(b.area_code))
    .slice(0, limit);
}

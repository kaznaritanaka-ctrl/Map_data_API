// 距離計算と最近傍探索。外部依存なし。

export interface Pt { id: string; lat: number; lng: number }

const R = 6371008.8; // 平均地球半径 (m)
const rad = (d: number) => (d * Math.PI) / 180;

/** 2点間の大圏距離 (m) */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 緯度経度の格子に点を入れ、近い順に輪を広げて最近傍を探す */
export class GridIndex<T extends Pt> {
  private cells = new Map<string, T[]>();
  private size = 0;
  constructor(pts: T[], private cellDeg = 0.01) {
    for (const p of pts) {
      const k = this.key(Math.floor(p.lat / cellDeg), Math.floor(p.lng / cellDeg));
      const arr = this.cells.get(k);
      if (arr) arr.push(p); else this.cells.set(k, [p]);
      this.size++;
    }
  }
  private key(i: number, j: number) { return `${i}:${j}`; }

  nearest(lat: number, lng: number): { pt: T; dist: number } | null {
    if (this.size === 0) return null;
    const ci = Math.floor(lat / this.cellDeg);
    const cj = Math.floor(lng / this.cellDeg);
    // 1セルの最小辺長 (m)。経度方向は緯度で縮む
    const cellM = Math.min(this.cellDeg * 111_000 * Math.cos(rad(lat)), this.cellDeg * 110_500);
    let best = null as { pt: T; dist: number } | null;
    for (let ring = 0; ring < 5000; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          const arr = this.cells.get(this.key(i, j));
          if (!arr) continue;
          for (const p of arr) {
            const d = haversine(lat, lng, p.lat, p.lng);
            if (!best || d < best.dist) best = { pt: p, dist: d };
          }
        }
      }
      // この輪より外の点は必ず ring*cellM 以上離れている
      if (best && best.dist <= ring * cellM) return best;
    }
    return best;
  }
}

/** 緯度経度 → タイル座標とタイル内ピクセル（256px タイル） */
export function tilePixel(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const xf = ((lng + 180) / 360) * n;
  const yf = ((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2) * n;
  const x = Math.floor(xf), y = Math.floor(yf);
  return { x, y, px: Math.min(255, Math.floor((xf - x) * 256)), py: Math.min(255, Math.floor((yf - y) * 256)) };
}

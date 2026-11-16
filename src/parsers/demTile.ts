// 地理院 標高タイル（テキスト形式）。256行×256列のカンマ区切り、無効値は "e"。
export function parseDemTile(text: string): (number | null)[][] {
  return text.trim().split("\n").map((line) => line.split(",").map((v) => (v === "e" || v === "" ? null : Number(v))));
}

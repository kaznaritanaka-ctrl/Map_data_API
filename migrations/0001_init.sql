-- 共通キーは国勢調査の小地域コード（KEY_CODE、先頭2桁が都道府県）
CREATE TABLE areas (
  area_code TEXT PRIMARY KEY,
  pref_code TEXT NOT NULL,
  city_code TEXT NOT NULL,
  city_name TEXT,
  name TEXT,
  rep_lat REAL NOT NULL,
  rep_lng REAL NOT NULL
);
CREATE INDEX idx_areas_city ON areas(city_code);
CREATE INDEX idx_areas_pref ON areas(pref_code);

CREATE TABLE layers (
  layer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT,
  source TEXT NOT NULL,
  license TEXT NOT NULL,
  attribution TEXT NOT NULL
);

CREATE TABLE snapshots (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  layer_id TEXT NOT NULL,
  scope TEXT NOT NULL,          -- 取得範囲（市区町村コードや都道府県コード）
  fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  r2_key TEXT,
  row_count INTEGER
);
CREATE INDEX idx_snapshots_layer ON snapshots(layer_id, fetched_at);

-- 町丁目ごとの値。取得のたびに行を足し、最新は snapshot_id の最大で引く
CREATE TABLE area_values (
  area_code TEXT NOT NULL,
  layer_id TEXT NOT NULL,
  snapshot_id INTEGER NOT NULL,
  value REAL,
  PRIMARY KEY (area_code, layer_id, snapshot_id)
);

CREATE TABLE facilities (
  type TEXT NOT NULL,           -- 'pharmacy' など
  facility_id TEXT NOT NULL,
  name TEXT,
  address TEXT,
  pref_code TEXT,
  city_code TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  elev_m REAL,
  first_seen TEXT NOT NULL,     -- 初めて取得データに現れた日
  last_seen TEXT NOT NULL,      -- 最後に取得データに現れた日（閉鎖の検知に使う）
  PRIMARY KEY (type, facility_id)
);
CREATE INDEX idx_facilities_pref ON facilities(type, pref_code);

CREATE TABLE recipe_results (
  recipe_id TEXT NOT NULL,
  area_code TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  nearest_facility_id TEXT,
  dist_m REAL,
  elev_diff_m REAL,             -- 町丁目の代表点 − 最寄り施設（正なら町丁目のほうが高い）
  PRIMARY KEY (recipe_id, area_code)
);

INSERT INTO layers VALUES
 ('pop_total','総人口','人','令和2年国勢調査 小地域集計（e-Stat）','政府統計の総合窓口 利用規約（CC BY 4.0 互換）','出典：政府統計の総合窓口(e-Stat)'),
 ('pop_65','65歳以上人口','人','令和2年国勢調査 小地域集計（e-Stat）','政府統計の総合窓口 利用規約（CC BY 4.0 互換）','出典：政府統計の総合窓口(e-Stat)'),
 ('pop_75','75歳以上人口','人','令和2年国勢調査 小地域集計（e-Stat）','政府統計の総合窓口 利用規約（CC BY 4.0 互換）','出典：政府統計の総合窓口(e-Stat)'),
 ('elev','代表点の標高','m','地理院タイル 標高タイル（国土地理院）','国土地理院コンテンツ利用規約','出典：国土地理院'),
 ('boundary','町丁・字等の境界','-','令和2年国勢調査 町丁・字等別境界データ（e-Stat）','政府統計の総合窓口 利用規約（CC BY 4.0 互換）','出典：政府統計の総合窓口(e-Stat)'),
 ('pharmacy','薬局','-','医療情報ネット オープンデータ（厚生労働省）','公共データ利用規約（PDL1.0）','出典：厚生労働省 医療情報ネット');

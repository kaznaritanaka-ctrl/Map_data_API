# Map_data_API

公開データを地図上に重ね、事業の種を蒔く場所を探すための個人用ツール。
Cloudflare 上で動く。当面は自分専用。

- 全体設計：[docs/design.md](docs/design.md)
- 対象：全国対応のキー設計。まず大阪府＋兵庫県、最小テストは明石市・神戸市・西宮市。

## 状態

段階1〜2の骨格（スキーマ、取り込み、レシピ計算、API、地図画面）まで実装済み。
作り物データでの動作確認のみで、実データの取り込みは未実行。検証状況は [docs/sources.md](docs/sources.md)。

## ローカルで動かす

```sh
npm install
npm test                 # 単体テスト
npm run db:local         # ローカル D1 にスキーマ適用
npm run seed:dev         # 作り物データを投入（実データではない）
echo 'ADMIN_TOKEN=dev-token' > .dev.vars
npm run dev
curl -X POST -H 'authorization: Bearer dev-token' 'http://localhost:8787/admin/recipe/uketashi-v1?pref=99'
```

## デプロイと初回取り込み（未実行）

1. `wrangler d1 create maps` → 出力の database_id を `wrangler.jsonc` に書く。`wrangler r2 bucket create maps-data`。
2. `npm run db:remote`、`wrangler secret put ADMIN_TOKEN`、`npm run deploy`。
3. `maps.ai-investment-research.net` をカスタムドメインに割り当て、Cloudflare Access でホスト全体を保護する。
4. 取り込み（`T` は ADMIN_TOKEN、`H` はホスト）。市区町村コードは明石市 28203、西宮市 28204、神戸市は区ごと（28101〜28111）。

```sh
for c in 28203 28204 28101 28102 28105 28106 28107 28108 28109 28110 28111; do
  curl -X POST -H "authorization: Bearer $T" "$H/admin/ingest/boundary?city=$c"; done
curl -X POST -H "authorization: Bearer $T" "$H/admin/ingest/age?pref=28"
curl -X POST -H "authorization: Bearer $T" "$H/admin/ingest/pharmacy?pref=28&url=<薬局zipのURL>"
curl -X POST -H "authorization: Bearer $T" "$H/admin/ingest/elevation?pref=28"
curl -X POST -H "authorization: Bearer $T" "$H/admin/recipe/uketashi-v1?pref=28"
```

各コマンドは件数を JSON で返す。境界は町丁目数を e-Stat の公表値と照合する。

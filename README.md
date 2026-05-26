# openclaw-livecoding-orchestrator

OpenClaw を docker compose で並列に走らせ、Strudel + Hydra のローカルライブコーディングセッションをオーケストレーションする実験リポジトリ。

## 構成

```
┌────────────────────────────────────────────────────────────────┐
│ Host Chrome  →  http://localhost:8080  (Strudel + Hydra page)  │
└────────────▲───────────────────────────────────────────────────┘
             │ WebSocket (hot-eval: {agent, code})
┌────────────┴──────────┐    ┌──────────────┐    ┌────────────┐
│   livecoding-host     │    │   validator  │    │ conductor  │
│  (Node + static SPA)  │    │  (dry-eval)  │    │ (bar tick) │
└──────▲────────────────┘    └──────▲───────┘    └─────┬──────┘
       │                            │                  │
       │   pattern.committed        │ POST /validate   │ bar.tick
       │                            │                  │
       │                  ┌─────────┴──────────────────▼─────┐
       │                  │            Redis pub/sub          │
       │                  └─┬──────────┬───────────┬─────────┬┘
       │                    │          │           │         │
       │            ┌───────▼──┐ ┌─────▼───┐ ┌────▼────┐ ┌──▼──┐
       └────────────┤ strudel- │ │ strudel-│ │ strudel-│ │hydra│
                    │  drums   │ │  bass   │ │  lead   │ │     │
                    └──────────┘ └─────────┘ └─────────┘ └─────┘
                       4 OpenClaw Gateway コンテナ (NVIDIA NIM 経由)
```

## エージェントの役割（初期固定）

| エージェント | 役割 |
|---|---|
| strudel-drums | ドラム/パーカッション |
| strudel-bass  | ベース/ハーモニー |
| strudel-lead  | リード/メロディ |
| hydra         | strudel の状態を読んで反応する映像 |

将来的にはプロンプト調整で動的な役割交渉に拡張する。

## ループ管理ポリシー

1. エージェントが新コードを生成
2. validator に POST して dry-eval（構文 + 1サイクル分のスモークテスト）
3. OK なら `session/<id>/<agent>/next.js` に書き、`pattern.proposed` を Redis に publish
4. conductor が次の bar 境界で `bar.tick` を流す
5. livecoding-host が WebSocket 経由でブラウザに hot-eval 指示を送る
6. 反映成功で `pattern.committed`、失敗で `pattern.rejected`

途中でコードが壊れても **音と映像は止めない**。古いパターンが鳴り続ける。

## 起動

```bash
cp .env.example .env
# NVIDIA_API_KEY を埋める
docker compose up -d
open http://localhost:8080
```

## 現状

実装途中。各コンポーネントの README を参照。

# openclaw-livecoding-orchestrator

実験的リポジトリ。**[OpenClaw](https://github.com/openclaw/openclaw) を docker compose で4つ並列に走らせて、Strudel + Hydra のローカルライブコーディングセッションをオーケストレーション** する。各エージェント = 独立した OpenClaw Gateway コンテナ。LLM は **Google Gemini 2.5 Flash**。

## 構成

```
┌─────────────────────────────────────────────────────────────┐
│  Host Chrome  →  http://localhost:8080                      │
│  (Strudel + Hydra hot-eval を1ページに同居)                  │
└────────────▲────────────────────────────────────────────────┘
             │ WebSocket (pattern.committed イベント)
┌────────────┴──────────┐   ┌──────────────┐   ┌────────────┐
│   livecoding-host     │   │   validator  │   │  conductor │
│  (Express + WS + SPA) │   │  (acorn 構文 │   │  (bar tick │
│                       │   │   + 識別子)   │   │   publish) │
└──────▲────────────────┘   └──────▲───────┘   └─────┬──────┘
       │                           │                 │
       │  pattern.committed         │ POST /validate │ bar.tick
       │                           │                 │
       │                ┌──────────┴─────────────────▼───────┐
       │                │            Redis pub/sub            │
       │                └─┬──────────┬──────────┬───────────┬─┘
       │                  │          │          │           │
       │       ┌──────────▼──┐ ┌─────▼────┐ ┌───▼─────┐ ┌──▼───┐
       └───────┤ strudel-    │ │ strudel- │ │ strudel-│ │hydra │
               │  drums      │ │  bass    │ │  lead   │ │      │
               │ (OpenClaw + │ │(OpenClaw │ │(OpenClaw│ │(OpenC│
               │  sidecar)   │ │ +sidecar)│ │ +sidecar│ │+side)│
               └─────────────┘ └──────────┘ └─────────┘ └──────┘
                          4 つの独立 OpenClaw Gateway
                          (Google Gemini 2.5 Flash 経由)
```

各エージェントコンテナは **OpenClaw Gateway 本体** + **sidecar Node ループ** を tini 配下で同居。sidecar が Redis の `bar.tick` を購読し、自分の番が来たら subprocess で `openclaw agent --message "<context>"` を叩いて Gemini にコード生成させる。

## エージェントの役割（初期固定）

| エージェント | 役割 | プロンプト |
|---|---|---|
| strudel-drums | ドラム/パーカッション | `agents/strudel-drums/prompt.md` |
| strudel-bass  | ベース/ハーモニー     | `agents/strudel-bass/prompt.md`  |
| strudel-lead  | リード/メロディ        | `agents/strudel-lead/prompt.md`  |
| hydra         | strudel に反応する映像 | `agents/hydra/prompt.md`         |

各役割プロンプトの先頭に **Strudel/Hydra のリファレンス** (`agents/_shared/*.md`) を連結して system prompt にする。リファレンスは公式 docs と hydra-synth ソースから抽出した正しい構文・関数シグネチャ一覧。LLM の幻覚（例：`euclid(3,8,">")`、`+1.5` 移調 etc.）を抑える。

## ループ管理

```
[bar.tick]
   ↓
sidecar が phase に該当するか判定 (bar % 16 == phase で発火)
   ↓
コンテキスト構築 (自分の前回コード + 他エージェントの最新 committed)
   ↓
openclaw agent --message "..." を subprocess 起動
   ↓ (Gemini が応答)
extractCode で reasoning を剥がして単一式を取り出す
   ↓
POST validator: 構文OK + 単一式 + 既知識別子チェック
   ↓ OK
session/<id>/<agent>/current.js に書く
pattern.committed を Redis publish
   ↓
livecoding-host が WS でブラウザに転送
   ↓
ブラウザの Strudel/Hydra が次サイクル境界で eval
```

途中で何かが壊れても **音と映像は止まらない**：
- validator が reject → エージェントは次のサイクルで再挑戦、他は据え置き
- ブラウザ側 eval が throw → host が「最後の good」にロールバック
- LLM レート制限 → 失敗としてログ、次サイクルでリトライ

## 起動

### 1. OpenClaw 本体イメージを準備（初回のみ）

```bash
git clone --depth 1 https://github.com/openclaw/openclaw.git third_party/openclaw
docker build -t openclaw:local ./third_party/openclaw   # 5〜15分
```

`third_party/` は `.gitignore` 対象。

### 2. API キー設定

```bash
cp .env.example .env
# .env を編集:
#   GEMINI_API_KEY=AIzaSy...
```

Gemini API キー: <https://aistudio.google.com/apikey>

### 3. 起動

```bash
docker compose up -d
open http://localhost:8080
# ページ上のオーバーレイをクリック (AudioContext 起動)
```

30〜40 秒で各エージェントが順番に commit を始め、ブラウザに音と映像が出る。

## ファイル構成

```
agents/
  loop/                       Sidecar ループの Docker image (FROM openclaw:local)
    Dockerfile / entrypoint.sh / loop.js / package.json
  homes/<agent-id>/           マウントされて /home/node/.openclaw になる
    openclaw.json             gateway 設定 + Gemini provider + agent 定義
    workspace/AGENTS.md       OpenClaw が system prompt に注入する役割定義
  <agent-id>/prompt.md        役割プロンプト (workspace/AGENTS.md の生成元)
  _shared/                    Strudel/Hydra リファレンス
    strudel-reference.md
    hydra-reference.md
livecoding-host/              SPA を配信、Redis → WebSocket ブリッジ
  src/{index,app}.html/.js    Strudel @1.3.0 + Hydra @1.3.29 (UMD)
validator/                    acorn ベースの構文・単一式チェック
conductor/                    BPM/拍子から bar.tick を周期 publish
session/<id>/<agent>/         各エージェントの最新 committed コード
docker-compose.yml
third_party/openclaw/         (gitignore) クローン専用
```

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| `gateway died before becoming ready` (config missing gateway.mode) | `openclaw.json` の `gateway.mode: "local"` 必須 |
| `unauthorized: gateway token missing` | `gateway.auth.token` と `gateway.remote.token` を **同じ値** にする |
| `No API key found for provider "google"` | `.env` 編集後に `docker compose up -d --force-recreate` してください（restart では env が反映されない） |
| `Unknown model: ...` | `models.providers.<provider>.models[]` に `{id, name}` を明示登録 |
| ブラウザがグレーで映像出ず | Strudel と Hydra が `window.speed` 等を取り合う問題。`hydra.sandbox.tick = () => {}` で同期を切る（コード内対応済） |
| `[mini] parse error` | LLM の幻覚。リファレンス強化で減少するが完全ゼロは不可。host 側ロールバックで音は維持 |

## 既知の課題

- **エージェントが互いを echo**: コンテキストで他エージェントのコードを見せると Gemini がそれを真似て同じ系統のコードを生成。bass が drums 風 stack を出す等
- **NIM 経由は不安定**: rate limit が厳しく、kimi-k2.6 では NIM 側サーバの 500（Python serializer bug）。NIM 直叩きの phase (c) は動作するが、OpenClaw 経由は Gemini が安定
- **conductor は単純な setInterval**: 長時間で drift する可能性
- **session memory**: 同じ `session-key` で OpenClaw のセッションを使い回し、過去のターン履歴が context に積もる。長時間運用でトークン圧迫の可能性

## 関連リンク

- OpenClaw: <https://github.com/openclaw/openclaw> / [Docs](https://docs.openclaw.ai)
- Strudel: <https://strudel.cc> / [mini-notation](https://strudel.cc/learn/mini-notation/)
- Hydra: <https://hydra.ojack.xyz/docs/>
- NVIDIA NIM (phase (c) で使用): <https://build.nvidia.com>

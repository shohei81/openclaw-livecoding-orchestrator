# Agent contract

各エージェントコンテナ（OpenClaw Gateway）が満たすべき振る舞い。
OpenClaw 本体の正確な image 名・config フォーマットがまだ確定していないため、
ここでは **役割と I/O の契約だけ** を定義し、配線は後段（実 image を入れる時）で行う。

## 環境変数

| key | 例 | 用途 |
|---|---|---|
| AGENT_ID | `strudel-drums` | エージェント識別子 |
| AGENT_ROLE | `strudel` or `hydra` | バリデータの lang として渡す |
| NVIDIA_API_KEY | `nvapi-...` | NIM 認証 |
| NVIDIA_BASE_URL | `https://integrate.api.nvidia.com/v1` | OpenAI 互換エンドポイント |
| NVIDIA_MODEL | `meta/llama-3.3-70b-instruct` | 使用モデル |
| REDIS_URL | `redis://redis:6379` | pub/sub |
| VALIDATOR_URL | `http://validator:8081` | 検証 POST 先 |
| SESSION_ID | `session-001` | セッション識別子 |

## I/O 契約（pub/sub）

### 購読

- `session.start` `{ session, bpm, beatsPerBar, startedAt }` — セッション開始
- `bar.tick` `{ session, bar, bpm, beatsPerBar, t }` — 小節境界（編集判断のトリガ）
- `pattern.committed` `{ session, agent, code, bar }` — 他エージェントの確定パターン

### 発行

- `pattern.proposed` `{ session, agent, code, bar }` — 新コード案（validator OK 後）
- `pattern.committed` `{ session, agent, code, bar }` — 反映確定後（host が出す or agent 自身が出す）
- `pattern.rejected` `{ session, agent, code, error, bar }` — validator NG 時

## ループ

```
on bar.tick:
  context  := { 自分の前回 code, 他エージェントの最新 committed, bar 番号 }
  prompt   := role_prompt + context
  new_code := NIM.complete(prompt)
  v        := POST validator { lang: AGENT_ROLE, code: new_code }
  if v.ok:
      session/<id>/<agent>/current.js を書き換え
      publish pattern.proposed
      （host が拾って次サイクルで eval、結果を pattern.committed/rejected）
  else:
      publish pattern.rejected
      （次の bar.tick で再挑戦）
```

エージェントは **毎 bar 必ず編集する必要はない**。「直近 N 小節は据え置く」「他エージェントの変化に反応した時だけ更新する」など、役割プロンプトで挙動を制御する。

## 役割プロンプト

`agents/<role>/prompt.md` にエージェント別の指示を置く。最初は固定。
- `strudel-drums/prompt.md`
- `strudel-bass/prompt.md`
- `strudel-lead/prompt.md`
- `hydra/prompt.md`

(まだ未作成。次のステップで書く。)

## TODO: OpenClaw 接続の確定事項

- [ ] 実 image 名 / tag
- [ ] role_prompt をどうマウント/注入するか（CLAUDE.md? config.yaml の system 領域?）
- [ ] NIM プロバイダ設定が `NVIDIA_API_KEY` だけで通るか、別途 provider 宣言が必要か
- [ ] エージェントから Redis を叩くのは OpenClaw のツール経由か、別ループスクリプトを同居させるか

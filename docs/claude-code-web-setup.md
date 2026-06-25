# 出先でClaude Codeと対話開発するための手順書（Claude Code on the web）

> 対象: 初心者向け。Windows + Git Bash 環境を前提に、出先（スマホ・ブラウザ）で
> 普段のClaude Codeと同じように対話しながら開発を進めるためのセットアップと使い方をまとめる。
> 出典は巻末の「公式ドキュメント」を参照。

---

## 0. これは何？（ざっくり）

**Claude Code on the web** は、いつものClaude Codeを**自分のPCの代わりにAnthropicのクラウド上で動かす**機能。

- ブラウザ（`claude.ai/code`）やスマホアプリから、いつもと同じように対話しながら開発できる
- クラウド上の仮想マシン（VM）が**GitHubからリポジトリをcloneして作業**し、ブランチをpushしてくれる
- 作業内容（diff）をその場でレビューして、PR（pull request）まで作れる
- **PC不要**。出先でスマホ1台でも回せる

> ⚠️ 現在 **リサーチプレビュー（research preview）**。利用できるのは **Pro / Max / Team** プラン。
> たまに仕様変更や不安定さがあるので、メインは普段のローカルClaude Code、出先用の延長として使うのが安心。

---

## 1. 一番大事な考え方（これだけは覚える）

クラウドのClaudeは、**あなたのPCの中身は一切見えない**。見えるのは **GitHubにpush済みのもの** だけ。

```
家のPCで作業 ──(git push)──> GitHub ──(clone)──> クラウドのClaude が作業
```

つまり：

1. **家を出る前に必ず `git push`** しておく（pushした内容だけがクラウドに届く）
2. クラウドのClaudeは `CLAUDE.md` と `docs/PRD.md` を読んでこのプロジェクトのルールを理解する（これらはリポジトリに入っているのでOK）
3. クラウドでの作業結果は**新しいブランチとしてpush**される → 家に帰ってから取り込める

---

## 2. 初回セットアップ（1回だけ。PCで行う）

セットアップ方法は2通り。**初心者には A（ブラウザ）がおすすめ**。

### A. ブラウザでセットアップ（おすすめ）

1. ブラウザで **https://claude.ai/code** を開く
2. Anthropicアカウント（普段Claude Codeで使っているもの）でサインイン
3. 「GitHubと接続」を促されるので、**Claude GitHub App** をインストールし、リポジトリへのアクセスを許可する
   - `office-action-app` リポジトリにアクセス許可を与える
4. 続いて **環境（environment）の作成** を求められる。初回は基本そのままでOK：
   - **Name**: 任意（例 `office-action-app`）
   - **Network access**: `Trusted`（npm等のパッケージ取得が可能。これで十分）
   - **Environment variables**: 後述（§5）。まずは空でOK
   - **Setup script**: まずは空でOK
   - → **Create environment** をクリック

これで完了。以降はブラウザ／スマホからすぐ使える。

### B. ターミナルでセットアップ（`gh` CLIを使い慣れている人向け）

> Git Bashユーザーは、スラッシュコマンドが**パス変換される不具合**に注意（§4参照）。

1. シェルでGitHub CLIにログイン: `gh auth login`
2. Claude Code を起動して `/login`（claude.aiアカウントでサインイン）
3. Claude Code の中で `/web-setup` を実行 → `gh` のトークンが連携され、デフォルト環境も自動作成される

---

## 3. 普段の使い方（出先での開発フロー）

### スマホ／ブラウザから

1. `claude.ai/code`（またはスマホのClaudeアプリの **Code** タブ）を開く
2. 入力欄の下の**リポジトリ選択**で `office-action-app` を選ぶ（必要ならブランチも選択）
3. **権限モード（permission mode）** を選ぶ：
   - **Plan mode**: まず方針を提案させ、こちらがOKを出してから編集（**初心者・重要な変更はこれが安心**）
   - **Accept edits**: 確認なしで編集してブランチをpush（軽微・明確なタスク向き）
4. やりたいことを具体的に書いて送信。例：
   - 「`docs/PRD.md` の Step1-3 の vertical slice を実装して。`CLAUDE.md` のGuardrailを守って」
   - 「`app/api/chat/route.ts` のストリーミング処理を説明しながら直して」
5. Claudeがclone→作業→ブランチpush。**対話しながら軌道修正**できる（いつものClaude Codeと同じ）

### 結果のレビューとPR作成

1. 画面の **diff インジケータ**（例 `+42 -18`）を開くと変更内容が見られる
2. 気になる行に**インラインコメント**を付けて送ると、Claudeがそこを直す
3. 問題なければ **Create PR** でPRを作成（フルPR／ドラフト／GitHub編集画面 から選べる）
4. PR作成後もセッションは続くので、CIエラーやレビュー指摘を貼って直してもらえる

> 💡 中核ロジック（PRD §11 の S6応答方針 / S8補正）は品質が重要。
> **いきなりmergeせず、必ずPRのdiffをレビューしてから手動でmerge**すること。

### 家に帰ってローカルで続きをやる（任意）

ローカルのClaude Codeで `claude --teleport` を実行すると、クラウドのセッションと
そのブランチをそのままPCに引き継いで続行できる（要: 同じclaude.aiアカウント、作業ツリーがクリーンなこと）。

---

## 4. ⚠️ Git Bash ユーザーの注意（重要）

Git Bashは先頭スラッシュ付きの引数を勝手にWindowsパスへ変換する（MSYS path conversion）。
そのため `claude /web-setup` のように打つと `C:/Program Files/Git/...` に化けて失敗する。

対処は以下のいずれか：

- **スラッシュコマンドはClaude Codeの対話画面の中で打つ**（シェルに直接打たない）。
  まず `claude` で起動 → プロンプトが出てから `/web-setup` と入力する。
- どうしてもシェル引数で渡すなら: `MSYS_NO_PATHCONV=1 claude`
- もしくは **PowerShell / コマンドプロンプト(cmd) から `claude` を起動**する（この問題が起きない。おすすめ）

---

## 5. このプロジェクト特有の注意（機密の扱い）

`CLAUDE.md` のGuardrail通り、`ANTHROPIC_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` などは秘密値。

- **クラウド環境には専用の秘密情報ストア（secrets store）がまだ無い**。環境変数（environment variables）に入れた値は、**その環境を編集できる人なら見える**状態で保存される。
- 出先での**コーディング作業そのものには、これらの本番シークレットは通常不要**。アプリを実際に起動して動作確認する必要がない限り、環境変数は**空のままでよい**。
- どうしてもクラウドでビルド/実行検証が必要な場合のみ、開発用のダミー値や検証用キーを環境変数に入れる。**本番のキーは入れない**。
- これはGuardrail①（APIキーをクライアントに出さない）②（RLS）の精神とも一致する。

---

## 6. クラウド環境に最初から入っているもの（参考）

このプロジェクトはNext.js。クラウドVMには **Node.js 20/21/22（nvm）、npm/yarn/pnpm、eslint、prettier** などが最初から入っているので、追加設定なしで動く想定。
PostgreSQL/Redisも入っているが既定では起動しておらず、必要ならClaudeに起動を頼む。
追加で入れたいツールがあれば環境の **Setup script** に `apt install` 等を書く。

---

## 7. スマホアプリの導入

- iOS / Android の **Claude** アプリをインストール → **Code** タブから利用
- ローカルのClaude Codeで `/mobile` を実行するとペアリング用QRコードが出る
- ブラウザを閉じても／タブを離れてもセッションは**バックグラウンドで継続**する

---

## 8. 困ったときに（よくあるトラブル）

| 症状 | 対処 |
|---|---|
| リポジトリが一覧に出ない | 接続したGitHubアカウントがそのリポジトリにアクセスできるか確認 |
| GitHubログインボタンしか出ない | GitHub未接続。ブラウザで接続するか `/web-setup` を実行 |
| `/web-setup` が "Unknown command" | シェルでなく**Claude Codeの中**で実行。古い場合は `claude update` → `/login` |
| セッションが作れない | `status.claude.com` を確認し、少し待って再試行。リポジトリのアクセス権も確認 |
| `--teleport` が使えない | claude.aiアカウントでログインしているか（`/login`）。APIキー認証だと不可 |

---

## 9. まとめ（Wataruさんの運用イメージ）

```
[家] ローカルClaude Codeで対話開発  ──> 出かける前に git push
                                              │
[出先] claude.ai/code または スマホアプリ で同じように対話開発
        → Plan modeで方針確認 → 実装 → diffレビュー → PR作成
                                              │
[家に戻る] PRをレビューして手動merge / または --teleport で続行
```

ポイントは3つだけ：
1. **出る前に push**
2. **Plan mode + PRレビュー**で安全に
3. Git Bashの**スラッシュコマンドは対話画面の中で**（またはPowerShell起動）

---

## 公式ドキュメント

- Get started（クイックスタート）: https://code.claude.com/docs/en/web-quickstart
- Use Claude Code on the web（詳細リファレンス）: https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web
- ニュース: https://www.anthropic.com/news/claude-code-on-the-web

---
allowed-tools: Bash(git log:*), Bash(git status:*), Bash(git branch:*), Bash(npm run test:coverage:*)
description: デプロイ前の最終チェックを行う（テスト・カバレッジ含む）
---

## デプロイ前チェックリスト

### 最近のコミット
!`git log --oneline -10`

### 現在のブランチ
!`git branch --show-current`

### 未コミットの変更
!`git status`

### テスト＆カバレッジ（最終確認）
!`npm run test:coverage 2>&1 | tail -20`

以下を確認してレポートしてください:
1. main ブランチにいることを確認
2. 未コミットの変更がないことを確認
3. テストが全件グリーンで、カバレッジ閾値（Lines: 70%）を満たしていることを確認
4. デプロイ可能かどうか最終判断を出してください

# M1 result fixtures

`m1-*.jsonl` は Claude Code 2.1.304 / Bedrock / `jp.anthropic.claude-sonnet-4-6` の M1 実地確認から、パーサーに必要な result 行を抜粋したものです。
生ログではありません。session UUID は置換し、環境・パス・認証・ツールの制御トークンを含めていません。
first と resume は同じ置換 session ID で、費用の差分を検証できます。予算超過・max turns・session 消失は区別してください。
実物の状態ファイルの由来は `../workspaces/m1-memo/provenance.json`、実測条件と費用は `../../docs/cli-spike.md` を参照してください。

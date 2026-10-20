# メモ一覧の設計書（合成 fixture）

実モデルで生成した成果物ではありません。

| 区分 | 章数 |
| --- | ---: |
| 記載済み | 3 |
| 未検討 | 2 |
| 対象外 | 1 |

## 要件

個人のメモを追加・一覧・削除できます。

[モックアップ](../intents/fixture-round-1/mockups/index.html)

## 表示安全性の合成ケース

[実行不可のリンク](javascript:alert(1))

![外部画像は自動取得しません](https://example.invalid/tracker.png)

<script>window.PREVIEW_XSS = 1;</script>

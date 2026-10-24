# 別PCからの共同利用（V3）

HTTPS共有サーバーとOIDC/MFA認証のコード・アプリUIは実装済み。ローカルの招待だけの検証アダプターとは別である。**実組織IdP/MFA、別の物理PC、実ネットワーク公開は未検証・未実施**。AWS/OS/firewall/IdP設定変更、外部デプロイ、永続資格情報の作成はこの実装作業では行っていない。

## 管理者が公開前に決めること

1. 公開HTTPS origin、配備先、受信ポート、公開対象ネットワーク、接続人数/運用者。Node 24.18以上の単一サーバープロセスと専用の永続データ領域を使う。SQLiteを複数サーバーから開かない。TLS秘密鍵は管理者が用意し、案件フォルダ/共有manifest/Gitへ入れない。
2. 有効なTLS証明書とfull chain、その秘密鍵の保管/更新。証明書検証の無効化、自動の自己署名証明書受入、`NODE_TLS_REJECT_UNAUTHORIZED=0`は使わない。通常アプリに独自CAを登録する導線はない。
3. 組織のOIDC issuerとnative public client ID、管理者本人の`sub`。署名はRS256/RSA2048bit以上、JWKSをHTTPSで取得する。現在はissuer・認可・token・JWKSが同じHTTPS originの構成のみ対応。異なるoriginが必要なIdPは黙って許可せず追加設計を要する。
4. Authorization Code + PKCE S256、external browser、`http://127.0.0.1:<動的port>/oidc-callback`のnative loopback redirectを登録する。client secretやrefresh tokenは不要。実IdPの登録/権限grantは別途承認が必要。
5. IdPでMFAを必須にし、署名付きID tokenに`auth_time`、`amr`の`mfa`（または管理者が検証したMFAレベルの`acr`）を含める。アプリ/サーバーは直近15分以内の本人認証とMFA claimを検証し、不足なら接続拒否する。単なるIdPログインや招待だけをMFA充足としない。`acr`の値は実IdPでMFAを保証する意味を確認してから設定する。
6. 招待先はIdPの確認済みメールアドレス（`email_verified: true`）へ結び付ける。所属/退職/権限削除とsession運用、データバックアップ、障害時復旧、サーバーの証明書・DBアクセス管理を決める。CLIのTeamログインは共有認証に流用しない。

例示ファイルは`examples/shared-server.example.json`。予約ドメイン/置換値であり、そのままで実サービスが動くという証拠ではない。実設定はリポジトリと案件保存先の外の管理者専用ファイルへ作成する。既存ローカル検証DBを本番認証へ黙って転用しない（owner/方式が違えば起動拒否）。

明示承認と設定準備後の起動方法（今回は実配備しない）:

```sh
V3_SHARE_CONFIG=/private/config/shared-server.json \
  node apps/collaboration/main.mjs /private/data/aidlc-sharing
```

サーバーは指定したTLS証明書を読み取り、指定host/portで待ち受ける。転送ヘッダーは拒否するため、現行実装はnative HTTPSへ直接接続する構成。リバースプロキシの信頼ヘッダーを勝手に導入しない。OSのネットワーク設定や受信許可はコード起動とは別の管理判断である。

## 利用者の画面操作

1. 「共同作業」で管理者が案内したHTTPS URLを入力し「HTTPS接続先を確認」。表示された接続先・issuer・client ID・MFAポリシーを確認する。
2. 初回参加者は、案件管理者から受け取った5分/一回限りの招待を入力。「本人のブラウザーでログイン（MFA）・招待参加」を押し、本人がブラウザーで操作する。アプリは自動承認/ログイン代行をしない。戻ったあと案件を選ぶ。管理者は設定済みの`sub`でログインし、共有案件を作る。既存参加者は再ログイン時の招待は不要。
3. 管理者は選択案件の権限と招待先の確認済みメールアドレスを指定して招待する。別人のMFA/別メールのtokenでは招待を使えない。招待のみでログインできるのはloopbackの独立した検証モードだけ。
4. 全員が同じ共有版を見る。「編集を開始」した一人だけが変更できる。ローカルの実ファイルが中央/右へ反映され、「変更を反映」でサーバーの全manifest検証・lease epoch・version CASを経て共有最新版になる。
5. コメントは入力開始時の案件と共有版に固定する。案件を切り替えても下書きを保持し、旧版への送信は明示確認する。「履歴から戻す」は過去版を消さず新しい版を作る。
6. 「編集を終了」または「切断」。失効/接続断でもローカルClaudeの停止と混同せず、その後の出力は回復用に隔離する。

編集リースの更新は、フォルダ選択・ダウンロードなどの長いUI/ファイル処理とは独立する。更新結果は接続/案件/編集フォルダ/epochが同じときだけ反映し、失効後の古い応答で編集を再開しない。

無効な認証は実ソケットの送信元ごとに制限し、有効な招待/challengeの消費とは分ける。転送ヘッダーや任意のclient IPは信用しない。challenge発行/保存と署名検証の同時数には別の上限があり、ネットワーク自体のDoS対策や公開設定を不要にするものではない。

OIDC ID token、PKCE verifier、共有session tokenはメモリにのみ保持し、設定・共有ファイル・ログへ保存しない。共有sessionは最大4時間かID tokenの期限の短い方。再認証時は本人が再度操作する。サービス再起動は全session/leaseを失効させ、共有版/履歴は保持する。CLAUDE/AWS資格情報は参照しない。

## 検証と限界

- 証明書検証を保った合成TLS CA/署名付き合成OIDCで、署名/issuer/audience/nonce/期限/MFA/招待本人不一致を拒否、native PKCE、20クライアントの同版閲覧・単一編集権・CAS・復元を検証する。
- 2つの独立Electronで同じHTTPSサーバーへ接続し、実際の画面ボタンから接続先確認、招待、ログイン、案件選択、編集、公開、実モック表示、コメント、履歴復元、切断/ログイン中止を検証する。OSブラウザー起動だけはテスト用inspectorの合成IdP応答へ置き換える。製品entry/IPC/HTTPS/OIDC/PKCEは共通コードを使う。
- テストCAの信頼は隔離したテストプロセスだけ。OSの信頼ストア・本人のブラウザー・実IdPは操作しない。これを本番MFA接続や別物理PCの受入完了と表現しない。
- 実IdPのMFAポリシー、native redirect登録、証明書/配備先/ネットワーク公開は管理者による別途設定と受入が残る。設定不能な方式へTLS/MFA検証を緩めて接続しない。

根拠: [OpenID Connect ID Token Validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)、[RFC8252 Native Apps / Loopback Redirect](https://www.rfc-editor.org/rfc/rfc8252)、[RFC8176 Authentication Method Reference](https://www.rfc-editor.org/rfc/rfc8176)。

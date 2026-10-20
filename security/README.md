# Chromium 検証専用 seccomp

既存15176 / 15178 / 5274へ適用しない。docker-compose.validation.ymlの固定名 aidlc-browser-validation 1個だけに使う。
非root、ブラウザsandbox、既存のcapability・IPC・namespace・mount制約を保持する。認証情報を渡さない。

現行Rancher Desktop 1.23.1 / Moby 29.5.2の有効プロファイルを基に、clone / setns / unshareのSCMP_ACT_ALLOWを1ルールだけ追加した。
defaultActionと既存ルールは変更しない。clone3のENOSYSと他の拒否も保持する。基準SHAはseccomp-provenance.jsonに記録。
コンテナ内の全プロセスがこの追加許可の対象になる。

[Playwright公式](https://playwright.dev/docs/docker#crawling-and-scraping)の非root＋namespace許可を参考にした。
公式サンプル全体は現行設定と異なり、io_uringやsocket等の余分な差分を含むため置換していない。
プロファイル基準はMoby由来のApache-2.0設定で、Rancher Desktopに同梱されたものを使用する。

適用前に有効プロファイルとのprefix一致と追加3 syscallだけであることをテストする。
上記を超える変更が必要な場合は停止する。ホスト全体、privileged、SYS_ADMIN、unconfined、sandbox無効化は使わない。

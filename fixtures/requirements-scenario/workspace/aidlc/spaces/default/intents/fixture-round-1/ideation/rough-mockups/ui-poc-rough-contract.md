# Synthetic reader fixture

Not official gate evidence. No model used, no person approval.

```ui-poc-contract
{
  "schema": 1,
  "stage": "rough-mockups",
  "assets": [
    {
      "path": "assets/index.html",
      "sha256": "4b9bedfe8e2e81017cea7dc506076b604c7e5bc1f4705147a16e3c104a228257"
    },
    {
      "path": "assets/style.css",
      "sha256": "aef4bb043be01602709c54c07a1e821328c71baac2fb3ac219ef69830878ee97"
    },
    {
      "path": "assets/error.html",
      "sha256": "0dd94987ec479734bde524e6158613be937833682f59841d1cd09c6fc1106043"
    }
  ],
  "mappings": [
    {
      "screen": "SCREEN-NOTES",
      "state": "EMPTY",
      "ac": "AC1.1.1",
      "asset": "assets/index.html",
      "check": "合成 fixture：メモを追加して確認"
    },
    {
      "screen": "SCREEN-NOTES",
      "state": "SUCCESS",
      "ac": "AC1.1.2",
      "asset": "assets/index.html",
      "check": "同じ HTML 内の操作で成功を確認"
    },
    {
      "screen": "SCREEN-NOTES",
      "state": "SUCCESS",
      "ac": "AC1.1.3",
      "asset": "assets/index.html",
      "check": "入力内容を保持"
    },
    {
      "screen": "SCREEN-NOTES",
      "state": "ERROR",
      "ac": "AC1.1.4",
      "asset": "assets/error.html",
      "check": "別 HTML のエラー画面"
    }
  ],
  "requiredMappings": [
    "SCREEN-NOTES/EMPTY/AC1.1.1",
    "SCREEN-NOTES/SUCCESS/AC1.1.2",
    "SCREEN-NOTES/SUCCESS/AC1.1.3",
    "SCREEN-NOTES/ERROR/AC1.1.4"
  ]
}
```

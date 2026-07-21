# Track Log Studio

純前端工具，用於**轉檔與分析賽道遙測記錄**——同時支援 ECU 記錄（aRacer `.loga`）與多款 GPS 資料記錄器格式。兩大功能：

1. **轉檔器** — 把記錄檔轉成 [RaceChrono](https://racechrono.com/) DIY `.nmea`（NMEA 0183 `$GPRMC` + `$RC3`）、`.loga`、RaceLogic `.vbo` 或 `.csv` 供下載。
2. **分析器** — 在賽道底圖上顯示軌跡、切圈、分段（sector），繪製遙測圖表與 G-G 圖，並可用可拖曳的儀表板同時比對多個圖表與多場次。

可匯入格式：**`.loga`、`.nmea`、`.vbo`、`.rcz`、`.rcnx`、`.xrk`、`.csv`**（外加 aRacer x Tune App 分享出的 `.zip`，自動解壓）；
可匯出格式：**RaceChrono `.nmea`、`.loga`、`.vbo`、`.csv`**。匯入採**可插拔的 Importer 架構**——每種格式是一個註冊在
registry 的 Importer（副檔名 + 內容嗅探偵測，解析在 Web Worker），新增文字格式只需註冊一個 Importer。
詳見 [`docs/ARCHITECTURE-FORMATS.md`](docs/ARCHITECTURE-FORMATS.md)。

正式站：**<https://tracklogstudio.timliudev.com/>**

**Track Log Studio** is a browser-based, **fully client-side** tool to convert
and analyse racing data logs — from ECU logs (aRacer `.loga`) as well as several
GPS data loggers. It **imports `.loga` / `.nmea` / `.vbo` / `.rcz` / `.rcnx` / `.xrk` / `.csv`** (plus aRacer x Tune
`.zip`) and **exports RaceChrono `.nmea`, `.loga`, `.vbo` and `.csv`**, then analyses laps,
sectors, telemetry and a G-G diagram on a drag-and-drop dashboard that can compare
multiple charts and sessions. Import uses a pluggable Importer architecture (one
registered importer per format). No backend — all processing happens locally in
your browser. Installable as a PWA on iOS / Android.

## 特色 Highlights

- 🔒 **純本地處理**，資料不上傳
- 📱 **PWA**，可安裝為手機 App、可離線
- 🖥️ **響應式**：手機 / 平板 / 桌面自動適應，亦可手動調整
- 🌗 **日夜模式**：跟隨系統或手動
- 🌐 **多語系**：繁體中文 / English（自動偵測 + 手動）
- 🧩 自動相容多種 `.loga` 檔頭（Super2 / SuperX / RaceAMP / aRacer X tune App）
- 📥 匯入 `.loga`、`.nmea`、`.vbo`、`.rcz`、`.rcnx`、`.xrk`、`.csv`，或 aRacer x Tune App 分享出的 `.zip`（自動解壓）
- 🔄 可匯出 RaceChrono `.nmea`、`.loga`、RaceLogic `.vbo`、`.csv`
- 📊 分析器：軌跡底圖、切圈與分段（sector）、遙測圖表、G-G 圖、可拖曳的多圖表儀表板
- 🧵 多場次載入、合併與比較（RaceChrono GPS ＋ ECU log 對齊）
- 💾 設定本地永久化，可匯出 JSON 轉移

## 支援來源 Supported sources

**ECU 記錄（aRacer `.loga`）— 經測試 Tested：**

1. RC super2 — 透過 SpeedTuning 2 回讀
2. RC superX — 透過 SpeedTuningX 回讀
3. aRacer X tune App — 透過分享功能輸出 log（`.zip` 可直接上傳）
4. aRacer Logger 2.5 Module — 透過 Logger2 Reader 讀出

**理論上支援但尚未測試 Expected to work, untested：** RC super、RC superXX、RC mini X、RC mini XX、aRacer Race Module 3

**GPS / 資料記錄器格式 GPS / data-logger formats（皆以真檔驗證 verified against real files）：**

| 格式 Format | 來源 Source | 說明 Notes |
|---|---|---|
| `.nmea` | RaceChrono DIY | NMEA 0183 `$GPRMC` + `$RC3`（本工具亦可匯出） |
| `.vbo` | RaceLogic VBOX | VBO 匯出的逆運算，round-trip 驗證 |
| `.rcz` | RaceChrono | ZIP + `session.json` + 逐通道二進位 |
| `.xrk` | AiM Solo 2 DL / MyChron5 | 訊息流二進位，GPS 為 ECEF→WGS84 |
| `.rcnx` | Qstarz LT-Q6000 / Q6000S（QRacing） | ZIP 內含 SQLite（`sql.js` 讀取） |
| `.csv` | 通用遙測 Generic telemetry | RFC 4180；標題列含 `Time`/`Timer`（亦為本工具匯出格式） |

各格式接入細節見 [`docs/IMPORT-FORMATS-STATUS.md`](docs/IMPORT-FORMATS-STATUS.md) 與 [`docs/specs/`](docs/specs/)。

## 開發狀態 Status

線上運作中、持續開發 / Live and under active development。設計與階段規劃見 [`docs/DESIGN.md`](docs/DESIGN.md)。

| 功能 Feature | 狀態 Status |
|---|---|
| 轉檔器（欄位對應 + preset + 批次，輸出 `.nmea` / `.loga` / `.vbo` / `.csv`） | ✅ |
| 衍生通道與避震校正（5 參數，全格式通用） | ✅ |
| 多格式匯入（`.loga` / `.nmea` / `.vbo` / `.rcz` / `.xrk` / `.rcnx` / `.csv`，可插拔 Importer） | ✅ |
| 分析器：軌跡底圖、切圈、遙測圖表、圈速時間帶／距離帶過濾 | ✅ |
| 賽道分段（sector）自動偵測與分段計時、最佳理論圈 | ✅ |
| G-G 圖、可拖曳／縮放的多圖表儀表板（手機摺疊／釘選／布局鎖定） | ✅ |
| 多場次載入、合併與比較（RaceChrono GPS ＋ ECU log 對齊） | ✅ |
| 多檔（multi-session）同時分析比較（跨檔疊圈、地圖疊圖與偏移對位、游標連動）、齒比併入主時序圖（衍生通道） | ✅ |
| 雲端賽道庫（公開賽道庫已內建種子資料並自動套用；社群 PR／CDN 分發層仍規劃中） | 🚧 規劃／進行中 |

## 技術 Stack

TypeScript · Vue 3 · Vite · Pinia · vite-plugin-pwa · uPlot · ECharts · grid-layout-plus · sql.js · fflate · vue-i18n

完整技術決策與理由見 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 開發 Development

> 需要 Node.js（建議 LTS）。Node 僅用於開發建置，上線後為純靜態網站、無伺服器執行。

```bash
npm install      # 安裝相依
npm run dev      # 本地開發伺服器（HMR）
npm run build    # 產生 dist/ 靜態檔
npm run preview  # 預覽 build 結果
npm test         # 執行單元測試
```

## 部署 Deployment

`npm run build` 產生的 `dist/` 為純靜態檔，由 **Cloudflare Workers**（靜態資產 +
Workers Builds，推上 GitHub 後自動建置部署）托管，無需自寫後端邏輯。
線上版：<https://tracklogstudio.timliudev.com/>

## 參考 Reference

- RaceChrono DIY 資料格式：<https://racechrono.com/article/2572>
- `loga2nmea.py` — 原始 Python 轉檔參考實作（本專案 `domain/export` 即移植自此）
- `LogaExample/` — 三種檔頭的 `.loga` 範例（Super2 / SuperX / RaceAMP）

## 商標聲明 Trademark notice

> **商標聲明：** Track Log Studio 為獨立的非官方工具，與 aRacer、RaceChrono 無任何隸屬或背書關係；文中提及僅用於描述相容性。aRacer 與 RaceChrono 為其各自所有者的商標。
>
> **Trademark notice:** Track Log Studio is an independent, unofficial tool and is not affiliated with or endorsed by aRacer or RaceChrono; those names are used only to describe compatibility. aRacer and RaceChrono are trademarks of their respective owners.

## 授權 License

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 timliudev.

## 第三方相依 Third-party

執行時相依套件及其授權（完整清單見應用內「關於」頁與 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)）：

- [vue](https://github.com/vuejs/core) — MIT
- [vue-i18n](https://github.com/intlify/vue-i18n) — MIT
- [pinia](https://github.com/vuejs/pinia) — MIT
- [echarts](https://github.com/apache/echarts) — Apache-2.0
- [uplot](https://github.com/leeoniya/uPlot) — MIT
- [grid-layout-plus](https://github.com/qmhc/grid-layout-plus) — MIT
- [sql.js](https://github.com/sql-js/sql.js) — MIT
- [fflate](https://github.com/101arrowz/fflate) — MIT
- [idb](https://github.com/jakearchibald/idb) — ISC
- [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) — MIT

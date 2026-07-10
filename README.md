# Track Log Studio

純前端工具，用於解析 aRacer ECU 的 `.loga` 記錄檔。兩大功能：

1. **轉檔器** — 把記錄檔轉成 [RaceChrono](https://racechrono.com/) DIY `.nmea`（NMEA 0183 `$GPRMC` + `$RC3`）、`.loga` 或 RaceLogic `.vbo` 供下載。
2. **分析器** — 在賽道底圖上顯示軌跡、切圈，繪製遙測圖表做賽道分析。

可匯入格式：**`.loga`、`.nmea`、`.vbo`、`.rcz`、`.rcnx`、`.xrk`**（外加 aRacer x Tune App 分享出的 `.zip`，自動解壓）；
可匯出格式：**RaceChrono `.nmea`、`.loga`、`.vbo`、`.csv`**。匯入採**可插拔的 Importer 架構**——每種格式是一個註冊在
registry 的 Importer（副檔名 + 內容嗅探偵測，解析在 Web Worker），新增文字格式只需註冊一個 Importer。
詳見 [`docs/ARCHITECTURE-FORMATS.md`](docs/ARCHITECTURE-FORMATS.md)。

正式站：**<https://tracklogstudio.timliudev.com/>**

**Track Log Studio** is a browser-based, **fully client-side** tool to parse
racing data logs: it **imports `.loga` / `.nmea` / `.vbo` / `.rcz` / `.rcnx` / `.xrk`** (plus aRacer x Tune
`.zip`) and **exports RaceChrono `.nmea`, `.loga`, `.vbo` and `.csv`**, then analyses laps
& telemetry. Import uses a pluggable Importer architecture (one registered
importer per format). No backend — all processing happens locally in your
browser. Installable as a PWA on iOS / Android.

## 特色 Highlights

- 🔒 **純本地處理**，資料不上傳
- 📱 **PWA**，可安裝為手機 App、可離線
- 🖥️ **響應式**：手機 / 平板 / 桌面自動適應，亦可手動調整
- 🌗 **日夜模式**：跟隨系統或手動
- 🌐 **多語系**：繁體中文 / English（自動偵測 + 手動）
- 🧩 自動相容多種 `.loga` 檔頭（Super2 / SuperX / RaceAMP / aRacer X tune App）
- 📥 可直接上傳 `.loga`、`.nmea`、`.vbo`，或 aRacer x Tune App 分享出的 `.zip`（自動解壓）
- 🔄 可匯出 RaceChrono `.nmea`、`.loga`、RaceLogic `.vbo`
- 💾 設定本地永久化，可匯出 JSON 轉移

## 支援來源 Supported sources

**經測試 Tested：**

1. RC super2 — 透過 SpeedTuning 2 回讀
2. RC superX — 透過 SpeedTuningX 回讀
3. aRacer X tune App — 透過分享功能輸出 log（`.zip` 可直接上傳）
4. aRacer Logger 2.5 Module — 透過 Logger2 Reader 讀出

**理論上支援但尚未測試 Expected to work, untested：** RC super、RC superXX、RC mini X、RC mini XX、aRacer Race Module 3

## 開發狀態 Status

🚧 開發中 / Under construction。詳見 [`docs/DESIGN.md`](docs/DESIGN.md)。

| 階段 | 內容 | 狀態 |
|---|---|---|
| Phase 0 | 專案骨架 + 三種 `.loga` parser + NMEA 輸出 + 測試 + PWA/i18n/主題殼 | ✅ |
| Phase 1 | 轉檔器（`.loga` → `.nmea`，可設定欄位對應 + preset + 批次） | ✅ |
| Phase 2 | 分析器（軌跡 / 圖表 / 切圈 / FFT…） | ⬜ |

## 技術 Stack

TypeScript · Vue 3 · Vite · Pinia · vite-plugin-pwa · uPlot · ECharts · vue-i18n

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

執行時相依套件及其授權（皆為 MIT，詳見 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)）：

- [vue](https://github.com/vuejs/core) — MIT
- [vue-i18n](https://github.com/intlify/vue-i18n) — MIT
- [pinia](https://github.com/vuejs/pinia) — MIT
- [uplot](https://github.com/leeoniya/uPlot) — MIT
- [fflate](https://github.com/101arrowz/fflate) — MIT
- [idb](https://github.com/jakearchibald/idb) — ISC
- [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) — MIT

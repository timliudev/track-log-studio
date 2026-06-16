# aRacerLogaAnalysis

純前端工具，用於解析 aRacer ECU 的 `.loga` 記錄檔。兩大功能：

1. **轉檔器** — 把 `.loga` 轉成 [RaceChrono](https://racechrono.com/) DIY `.nmea`（NMEA 0183 `$GPRMC` + `$RC3`）供下載。
2. **分析器** — 在賽道底圖上顯示軌跡、切圈，繪製遙測圖表做賽道分析。

A browser-based, **fully client-side** tool to parse aRacer ECU `.loga` logs:
convert them to RaceChrono `.nmea`, and analyse laps & telemetry. No backend —
all processing happens locally in your browser. Installable as a PWA on iOS /
Android.

## 特色 Highlights

- 🔒 **純本地處理**，資料不上傳
- 📱 **PWA**，可安裝為手機 App、可離線
- 🖥️ **響應式**：手機 / 平板 / 桌面自動適應，亦可手動調整
- 🌗 **日夜模式**：跟隨系統或手動
- 🌐 **多語系**：繁體中文 / English（自動偵測 + 手動）
- 🧩 自動相容多種 `.loga` 檔頭（Super2 / SuperX / RaceAMP）
- 💾 設定本地永久化，可匯出 JSON 轉移

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

`npm run build` 產生的 `dist/` 為純靜態檔，推上 GitHub 後由 **Cloudflare Pages**
托管即可，無需後端或 Worker。

## 參考 Reference

- RaceChrono DIY 資料格式：<https://racechrono.com/article/2572>
- `loga2nmea.py` — 原始 Python 轉檔參考實作（本專案 `domain/export` 即移植自此）
- `LogaExample/` — 三種檔頭的 `.loga` 範例（Super2 / SuperX / RaceAMP）

## 授權 License

TBD

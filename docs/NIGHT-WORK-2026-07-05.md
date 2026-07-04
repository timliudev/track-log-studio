# 夜間工作報告 — 2026-07-05

> 使用者打球中,授權全自動執行。範圍與策略於 01:00 討論定案。

## 定案內容

| 項目 | 決定 |
|------|------|
| 範圍 | T6 Phase5 合併 UI → T7 彎道偵測 UI → T8 B6 彈性面板佈局 → 維護包(GG bundle 分割+依賴更新)→ A2/A3 雲端賽道機制 |
| 合併策略 | 每 task feature branch → --no-ff 進 develop → push;全數完成且測試綠燈後 develop → main 釋出+部署 |
| 執行方式 | 每 task 由 Sonnet 5 sub-agent 實作,小步 commit;A2/A3 做不完就留 feature branch 不合併,不擋 main |

## 進度總覽

| # | 任務 | 狀態 | 分支 | 備註 |
|---|------|------|------|------|
| T6 | Phase 5 場次合併 UI | ✅ 已合併 develop(06442f7) | feature/phase5-merge-ui | 711 測試綠、build 綠 |
| T7 | 彎道偵測接上 UI | ⏳ 進行中 | feature/corner-detection-ui | |
| T8 | B6 彈性面板佈局 | ⬜ 排隊 | feature/flexible-panel-layout | |
| M | 維護包:GG bundle 分割+依賴更新 | ✅ 已合併 develop(ee5d12b) | chore/maintenance-0705 | precache -64%;711 測試綠 |
| A | A2/A3 雲端賽道機制 | ⬜ 排隊 | feature/cloud-track | 範圍大,可能部分完成 |
| R | develop → main 釋出+部署 | ⬜ 排隊 | — | 綠燈才做 |

## 各任務詳情

### T6 Phase 5 場次合併 UI ✅

儀表板新增常駐卡片「GPS 場次合併」(左欄 track-file 卡下方,不需選圈即可見):

1. 選「主要記錄」(缺 GPS 的 .loga)與「GPS 來源記錄」(如 .nmea)
2. 「自動對齊」→ 用既有 `crossCorrelateOffset`(速度頻道交叉相關)算時鐘偏移與相關性分數
3. ±100ms 按鈕微調偏移
4. 「合併並加入記錄」→ `mergeSessions` 產生新 session 掛回 fileStore,可直接切換檢視、經轉換頁匯出

主要新檔:`useSessionMerge.ts` composable(8 個測試)、`SessionMergePanel.vue`;fileStore 新增 `addMergedSession` + `'merged'` 檔案類型;zh-Hant/en locale 已補。

**待你驗收**:sub-agent 的預覽環境有 tab 切換卡住的既有問題(未改動的檢出也重現),面板實際畫面請實機點一次;合併前的 GPS 軌跡疊圖預覽未做(成本低,可後續加)。

### M 維護包 ✅

**M1 — GG echarts bundle**:調查發現程式碼分割其實已完成(GgChart 獨立 chunk 479.84 kB,不在首屏),真正缺口在 **PWA precache**:vite-plugin-pwa 預設會把延遲載入的 GgChart echarts chunk 與 sql.js wasm 一併 precache,架空了分割目的。修法:`globIgnores` 排除 + `runtimeCaching`(CacheFirst)在實際使用時才快取。**Precache 從 24 entries / 1864 KiB → 20 entries / 685 KiB(-64%)**。

**M2 — 依賴更新**:`vite 8.1.2→8.1.3`、`wrangler 4.102→4.107`、`@cloudflare/vite-plugin 1.42.4→1.43.0`(皆同 major 內),其餘依賴已是最新;`npm audit` 前後皆 0 漏洞。

## 事件記錄

- 01:00 討論定案,開始執行。起點:develop 1af3481(與 origin 同步)。
- 01:05 使用者追加授權:可並行的任務開 worktree 並行。T6 留主目錄,A2/A3 與維護包各開 worktree。
- 01:18 `npm install` 遇 EBUSY(miniflare 被鎖):主 repo 有殘留的 vite dev server(昨晚 19:03/19:41 兩個 preview + 今天 00:37 的 `npm run dev --host`,可能是你出門前開的)。已全部收掉才解鎖 — **如果那個 dev server 是你故意留的,抱歉,重開 `npm run dev` 即可**(依賴更新後本來也要重啟)。無關的 MCP server 程序未動。

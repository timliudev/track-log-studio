# 晚間自動工作 2026-07-07

> 使用者 21:30 出門打球,授權全自動推進。規則:動工前查官方用量(claude.ai UI via Chrome),
> 5hr ≥80% 不發新 agent、≥90% 收尾、95%/週 98% 硬限;全部 sub-agent(sonnet)並行、
> 小步快跑 commit、routines 排程周而復始直到做完;留文件複查。
> 開工用量(21:37 官方):session 32%(00:17 重設)、週 All models 33% / Fable 47%(週一 04:59 重設)。

## 使用者出門前拍板(AskUserQuestion 四題,全採建議方案)

1. **鎖定 UX(#1+#21)**:兩個功能、兩個圖示 — 每卡片 📌=滾動時固定於畫面(手機+PC);工具列 🔒=鎖定整體布局禁拖禁縮。
2. **避震校正(#8+#9)**:共用車輛設定 store(同傳動設定層級),轉換頁+分析頁都有編輯入口,localStorage 持久化、各格式通用。
3. **輪胎換算(#10)**:輸入規格即時換算+自動套用為周長(免按按鈕,仍可手動微調)。
4. **賽道庫(#16)**:暫緩建 repo,先寫方案比較報告(GitHub+jsDelivr vs Firebase vs Cloudflare KV/R2 vs Supabase),使用者回來拍板再動工。

主 session 自行決定(低風險、可逆,已在回覆中告知方向):
- **#7 star 按鈕**:header 右側、inline SVG(不用外部 script,PWA 離線+隱私),GitHub API 取 star 數優雅降級。
- **#20 docs 整理**:日誌**保留在 git**(不 gitignore — 記憶與驗收流程都引用它們),歸檔到 `docs/journal/`;格式規格移 `docs/specs/`;DESIGN.md 收待辦/已完成總表。
- **#22 先釋出**:develop(含 analytics)→ main,push 觸發 Workers Builds 部署。

## 22 項回饋триage

| # | 項目 | 歸屬 | 狀態 |
|---|------|------|------|
| 1+21 | 鎖定兩功能分離(📌sticky+🔒布局鎖) | Agent A feature/dashboard-lock-and-mobile | 🔄 W1 |
| 3 | 手機不能調 grid 大小 | Agent A | 🔄 W1 |
| 6 | grid 預設填滿頁面 | Agent A | 🔄 W1 |
| 12 | tooltip 直角黑色 → 圓角主題化 | Agent B feature/ui-polish-branding | 🔄 W1 |
| 13 | 副標題去 aRacer 中心化 | Agent B | 🔄 W1 |
| 14 | 轉換頁說明文案通用化 | Agent B | 🔄 W1 |
| 7 | GitHub star 按鈕(header 右側) | Agent B | 🔄 W1 |
| 8+9 | 避震校正全格式+共用車輛設定 store | Agent C feature/suspension-universal | 🔄 W1 |
| 11 | Cloudflare Web Analytics | 主 session | ✅ index.html |
| 22 | 推一版到 main | 主 session | 🔄 本次 |
| 2 | 地圖疊多檔案軌跡 | Agent D(W2) | ⏳ |
| 4 | XY 散佈圖 1:1 等比(可調) | Agent E(W2) | ⏳ |
| 10 | 輪胎規格即時換算套用 | Agent E(W2) | ⏳ |
| 5 | 拖動 grid 縫隙調整整頁布局 | Agent F(W2,依賴 A) | ⏳ |
| 16 | 賽道庫方案比較報告 | Agent G(W2,docs) | ⏳ |
| 20 | docs 分類整理 | Agent G(W2) | ⏳ |
| 18+19 | UX/載入+計算效能審計(先量測後行動) | Agent H(W2) | ⏳ |
| 15 | 測試 log 來源(唯讀):`C:\Users\c1211\OneDrive\aracer`、`C:\Users\c1211\OneDrive\Documents\aRacerLogSave`;要改先複製到 LogaExample | 給所有 agent 的資訊 | 📝 |
| 17 | 架構整潔、必要就重構 | 寫進所有 agent prompt | 📝 |

## 進度紀錄

- 21:33 開工。本機 monitor 僅節奏參考(17%);官方 32%/33%/47%。
- 21:40 四題拍板(見上)。Wave 1 三 agent 並行開出(A 儀表板鎖定、B UI 磨光、C 避震通用),各自 worktree、sonnet、含反轉派條款。
- 21:45 主 session:analytics 進 index.html、本文件建立。接著:commit → develop→main 釋出 → 排程(00:17 重設+5min dead-man + 續跑 routine)。

## 待辦(下個窗口/routine 接手時從這裡讀)

- [ ] Wave 1 三分支驗收合併(A/B/C 完成後:review diff → npm test → merge --no-ff 進 develop,每合一支查用量)
- [ ] Wave 2:D 多檔軌跡疊圖、E XY 1:1+輪胎即時換算、F 縫隙拖動(等 A 合併)、G 賽道庫報告+docs 整理、H 效能審計
- [ ] Wave 2 全合併後:第二次 release main(視驗收情況)
- [ ] 記憶更新+最終驗收摘要寫進本文件

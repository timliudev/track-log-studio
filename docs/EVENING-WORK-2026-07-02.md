# 下班工作報告 — 2026-07-02（晚）

> 處理使用者白天對「7-01 夜間 14 功能批次」的實測回饋（A1-A16 + B1-B7，
> 完整清單見 session 記憶 testing-backlog-2026-07-02）。模式同前夜：sub-agent
> （Sonnet 5）+ isolated worktree 並行、小步 commit、feature → develop `--no-ff`、
> 驗證後 push。main 不動（待使用者驗收後 release）。

## 使用者決策（下班討論定案）

- **A11 齒比計算器**：做「計算機 + log 反推」雙層 — (1) 手動輸入傳動規格算對照表；
  (2) 由 log 的 RPM/速度反推實際總傳動比曲線（MT 看檔位水平段、CVT 看變速比曲線）。
- **B2 xrk 輸出**：不做（AiM 私有格式無寫入逆向、風險高）→ 改做 **通用 CSV 輸出**
  （Race Studio 3 可匯入 CSV，達成同一目的且對其他工具通用）。
- **今晚重構全做**：A1+A15 gate 流程重設計、A9 標記與上色整合、A10+A12 G-G 圖表化、
  B5 底部導航。
- **A2/A3（雲端賽道圖）**：方向確認 — 載入時主動比對並套用對應賽道圖+設定，之後
  使用者再調；個人習慣設定歸個人雲端備份；公共賽道圖考慮走 git repo + PR 眾人維護
  （GitHub 免費）。**本晚不實作**，留待後續討論定案。

## 解釋類問題（已答，未動碼）

- **A14**：時間軸=整段時序圖；疊圈=選取的圈重疊到同一 X 原點比較（色=圈、線型=通道）。
- **A5**：偵測=曲率/傾角訊號的 prominence 局部峰 + 15m NMS；門檻僅以 ARK 校準，
  換賽道尺度誤偵直線=已知泛化缺口 → 由 A1+A15 的自由增減修正。
- **A6**：排除=「依序通過每一個已確認 gate」；誤偵 gate 混入會讓正常圈 fail —
  是 A5 的下游災情。
- **B5/B6 是否提過**：有 — 4e layout（#12/#8 動畫）與 draggable dashboard、F 手機 pass。

## 波次規劃

- **波1（進行中）**：A16 rcnx wasm 修復｜A13 模式切換掉選取 + B1 驗證｜UX 批次
  （A4 編號、A7 排除樣式統一、A8 band 自動帶入、B3 按鈕提示、B4 設定搬家）。
- **波2**：A1+A15 gate 流程重設計｜B2 CSV 輸出｜B5 底部導航｜A11 齒比計算器。
- **波3**：A9 標記整合 → A10+A12 G-G 圖表化（依 TrackMap/analyzerStore 衝突排序）。
- **收尾**：B7 架構審查（/simplify 式全面檢視）、手冊同步（實作必同步文件）、報告完稿。

## 進度日誌

### ✅ UX 快修批次（已併入 develop `628e888`，450 tests 綠）
- `feature/ux-batch-0702` @ `f56637a`。model: Sonnet 5。
- **A4** 候選彎道清單加編號徽章（呼應地圖 gate 編號）。
- **A7** 排除視覺統一：`lapStore.exclusionReason(i)`（manual > band > sector 優先序），
  ⦸ 反映聯集狀態，自動排除者顯示「開啟但不可手動解除」+ 原因 tooltip
  （i18n `excludedByBand`/`excludedBySector`）。
- **A8** 有效圈速區間自動帶入：純 `suggestLapTimeBand`（距離合理圈的中位圈時 ±20%），
  僅未設定時、每新 session 帶一次，不覆蓋使用者值。
- **B3** 載入按鈕→`＋ 載入記錄` + tooltip 由 import registry 衍生（不再手寫格式清單）。
- **B4** 主題/語言由 header 搬入設定分頁（保留 name/a11y 屬性）。
- 16 新測試。**待視覺驗收**：A4 徽章樣式、A7 tooltip、B3 提示、B4 設定版面。

### 🔄 進行中（6 agent 平行，isolated worktrees）
- 波1：`fix/rcnx-wasm`（A16 wasm MIME）｜`fix/chart-mode-selection`（A13 + B1 驗證）
- 波2：`feature/gate-flow`（A1+A15 流程重設計）｜`feature/csv-export`（B2 改 CSV）｜
  `feature/gear-calc`（A11 齒比雙層）｜`feature/bottom-nav`（B5 底部導航）

### ⏳ 波3（等 gate-flow 併入後依序）
- A9 標記與上色整合 → A10+A12 G-G 圖表化 → B7 架構審查 → 手冊總同步 → 報告完稿

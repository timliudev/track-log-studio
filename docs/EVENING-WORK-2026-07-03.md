# 傍晚回饋處理 — 2026-07-03(17:30 開工)

> 20 點使用者回饋的處理記錄。基準 develop `ffc7bf1`(537 tests)。main 不動。

## 討論定案(17:3x)

- **#8 PC 布局**:直接上拖曳網格。選 `grid-layout-plus@1.1.1`(Vue 3 原生、responsive breakpoints、拖曳+resize+序列化;vue-grid-layout 停更於 Vue 2,gridstack 非 Vue 原生)。
- **#9 手機布局**:單欄+面板收闔+可調順序,支援「鎖定某格」(如軌跡圖釘選在頂端,下方內容獨立滾動)。
- **#11–13 變速比**:檔車=幾何計算(1–6 檔齒比/齒數、終傳、輪胎規格→各檔理論速度-轉速線疊實測散佈+檔位判別);速可達 CVT=實測變速比曲線呈現+起步比/最終比/接合轉速標注,普利珠重等參數當「筆記欄位」記錄供調校對比,不做幾何模擬。
- **#18 A2/A3**:全採設計文件建議(獨立 tracks repo/CC0/內建快照+jsDelivr/個人雲端後期),本次只做 Phase 1(本地 schemaVersion + 載入自動套用)。
- **#15 XYZ 圖**:建議改用「2D 散佈 + 顏色第三軸」;等使用者回應再做。
- **#4 首次切換分頁較慢**:是一次性元件初始化,非 bug;可選 idle 預熱(暫不做)。
- **#6 拆開的原因**:避震校正是轉檔+分析共用的衍生通道所以當初放設定;UI 動線上仍搬到轉換頁(store 共用不變),另存 loga 併入輸出格式選單(僅來源為 loga 時可選)。

## 任務看板

| Wave | 項目 | 狀態 | 分支 / 合併 |
|------|------|------|-------------|
| 1 | #1/#2/#5 文案:格式清單重寫+空狀態+分頁改名 | ✅ `b119683` | 格式清單改由 import registry 動態產生(ⓘ 揭示面板,轉換/分析都看得到) |
| 1 | #10/#16 散佈圖軸名+resize | ✅ `7e88dc2` | 軸名=echarts name;溢出根因=flex min-width:auto,+min-width:0 修復 |
| 1 | #17 疊圈X軸消失 + #7 軌跡極值數值標示 | ✅ `93da64b` | #17 根因:axes 帶 space:undefined 鍵蓋掉 uPlot 預設→findIncr 放棄畫刻度;#7 標記旁 11px 主題色數值+光暈。⚠️#7 待視覺驗收 |
| 1 | #3 拖放匯入 + #19 轉換頁溢出 + #20 導覽icon | ✅ `41d915e` | 拖放走同一 intake(含 zip);#19 根因 grid min-width:auto;#20 統一 currentColor SVG。⚠️#19/#20 待視覺驗收 |
| 1 | #14 有效圈距離區間 | ✅ `6be56f3` | 距離帶與時間帶並存(兩者都要過),預設=合理圈中位數±20%,km 三位小數,+26 tests |
| 2 | #6 避震校正+另存loga搬轉換頁 | ✅ `9b6a7b0` | 避震=轉換頁收合區塊;另存loga=輸出格式第4鈕(僅loga來源可用,特殊case不進registry);手冊已同步。⚠️ 待視覺驗收 |
| 3 | #8 PC 拖曳網格布局 | ⏳ | `feature/dashboard-grid` |
| 2 | #11–13 變速比計算機重做 | ⏳ | `feature/drivetrain-rework` |
| 2 | #18 A2/A3 Phase 1 | ✅ `3aca9eb` | schema v1(TrackDefinitionV1 預留/PersonalTrackOverlayV1 實裝)+舊 idb/檔案透明遷移+自動套用改走 resolveGeometryToApply,+25 tests |
| 3 | #8 PC 拖曳網格布局(grid-layout-plus) | ⬜ | — |
| 3 | #9 手機布局(收闔+鎖定) | ⬜ | — |

## 事件記錄

- **~18:3x 再度撞 session 用量上限**(重置 22:30)— 進行中的 4 個 agent(#17/#7、變速比、A2/A3 P1、#6)中斷。#17 修復已有正式 commit(`9631929`,根因:axes 配置帶了 `space: undefined` 鍵),#7/變速比/A2A3 的半成品以 `wip:` commit 保進各自分支,#6 無進度。22:30 後全部重啟續作。

## 各項詳細記錄

(隨任務完成補上)

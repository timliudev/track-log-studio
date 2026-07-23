# F5 — 行動版單焦點視圖 (Single-Focus Mobile View)

狀態:設計已定向(user 決策 2026-07-24)。取代 [[F1]] 的聚焦堆疊(MobileFocusStack + 分隔線)。實作待落地。

## 1. 決策與動機
手機一次只顯示**一個**主視覺,而非把多張卡片疊在一起。動機來自 F1 聚焦堆疊的裝置回饋:
- **Q2/Q3**:`focusStackIds` 把全部可見卡塞進堆疊,每卡 `min-height:180px`、總高超過視窗→整體捲動→`flex-grow` 權重無空間→分隔線拖不動(no-op)。
- **Q6**:scrubber 被推到長堆疊最底,未達「常駐底部」。
- **Q10 結論**:卡片/儀表板是桌面範式;手機專業遙測 App(RaceChrono/TrackAddict)都用單焦點+切換。硬疊卡片是逆風。

單焦點一舉消滅:分隔線、行動拖曳排序、二指仲裁、CardMenu 選單溢出(Q5)整類問題。

## 2. UX 模型
```
┌─────────────────────────────┐
│ [地圖][圖表][圈表][散佈] …   │ ← 頂部分頁列(segmented / 可水平捲動),點=切換
├─────────────────────────────┤
│                             │
│      單一主視覺(全螢幕)      │ ← 目前選中的一個 view,填滿中間全部空間
│                             │
├─────────────────────────────┤
│ ▶  ├──────●─────┤ 0:12/1:03 │ ← 常駐 scrubber+play(沿用 MobileScrubber)
└─────────────────────────────┘
        (BottomNav 轉換/分析/設定)
```
- 切換:點分頁,或在主視覺區**左右滑**切換(swipe，可 phase 2)。
- 共用游標:scrubber 拖動 → `analyzer.setCursor` → 所有 view(含地圖、overlay 圖表)既有 `cursorIdx` 反向連動(零新狀態,同 F1 phase 3 機制)。
- play/▶:沿用 MobileScrubber phase 4。

## 3. 沿用 vs 淘汰(F1 資產)
| F1 資產 | 去留 |
|---|---|
| `MobileScrubber.vue` / `scrubber.ts` / scrubberDomain / cursor 同步 | **沿用**(單焦點底部同一條) |
| play/▶(phase 4) | **沿用** |
| `edgeAutoscroll.ts` / gesture-engine(phase 5) | 沿用(僅「完整」模式的桌面式卡片拖曳仍需) |
| `AnalyzerCardBody.vue` dispatcher + `AnalyzerCardContext` | **沿用**(每個 view = 一個 card body) |
| `MobileFocusStack.vue` + 分隔線(phase 1-2) | **淘汰/取代** |
| `mobileView.splitWeights` + `setWeight`/`setSplitWeight` | **淘汰**(單焦點無高度分配) |
| Q4 `.focus-expand` 放大鈕 | 隨堆疊移除,不另處理 |

## 4. 狀態與持久化(`useMobileView` / mobileView.ts)
- `mode: 'focus' | 'full'` **保留**:`focus` 現在指「單焦點視圖」,`full` 仍是完整卡片儀表板(進階)。手機預設 `focus`。
- 新增 `currentViewId: string`(目前選中的 view/card id);切換分頁時更新並持久化。reconcile:若持久的 id 已不可見/不存在→退回第一個可見 view。
- `focusOrder` **保留**:決定分頁順序(可見集在前、其餘接後,同 `resolveFocusStackOrder`)。
- `splitWeights` / `weightFor` / `setSplitWeight`:標記 deprecated,sanitize 時忽略(保留欄位相容,不再讀寫)。

## 5. 「有哪些分頁」= F2 可見集
分頁 = `mobileOrder.filter(isVisibleId)`(同 F1 `focusStackIds` 來源),但**一次顯示一個**。
- 圖表可多實例→每個實例一個分頁(沿用 chartIds)。
- 無資料的 view 依 `cardDataAvailability` 預設關→不出現在分頁。
- 分頁列過長→水平捲動(不換行)。

## 6. 元件計畫
- 新 `MobileFocusView.vue`(取代 `MobileFocusStack.vue`):頂部分頁列 + 單一 `<AnalyzerCardBody :id="currentViewId">` + 底部 `<MobileScrubber>`。`v-if/v-else` 與 grid 互斥(同 F1,絕不同時掛載)。
- AnalyzerView:`showFocusStack` → `showFocusView`;`focusStackIds` 沿用為分頁清單;`focusScrubberDomain`/scrubber wiring 不變;移除 `focusWeightFor`/`onFocusResize`。
- 填滿:主視覺區 `flex:1; min-height:0; overflow:auto`(讓地圖 fill、圈表內捲各自運作);沿用 `.analyzer.focus-mode { height:100% }` 高度鏈。

## 7. 互動細節
- 分頁鈕:§8 coarse 44px 觸控目標;active 高亮(同 `.xaxis` segmented 語言)。
- 主視覺區左右 swipe 切換分頁:phase 2(需與圖表/地圖自身的水平手勢仲裁——地圖平移、圖表 zoom-pan 會搶;初版先只用分頁點按,swipe 後補並小心 pointerType/touch-action)。
- 地圖 view:既有 in-card maximize(B7)在單焦點下已等於全螢幕,可保留或隱藏。

## 8. 分期
- **Phase 1**:MobileFocusView(分頁點按切換 + 單 view + 沿用 scrubber),淘汰 MobileFocusStack/分隔線;mobileView 加 `currentViewId`、deprecate splitWeights。→ 可裝置驗證的最小完整體。
- **Phase 2**:主視覺區左右 swipe 切換(手勢仲裁)。
- **Phase 3**:分頁列圖示化/精簡、每 view 記住上次捲動位置等打磨。

## 9. 待確認(實作前可問,或實作中依現況判斷)
- 分頁要「文字」還是「圖示+文字」(空間)。
- swipe 切換 vs 圖表/地圖水平手勢的優先權(建議 phase 1 先不做 swipe)。
- 「完整」模式(卡片儀表板)手機是否仍保留為進階入口,或手機只留單焦點(建議保留 full 作進階,mode 切換鈕沿用)。

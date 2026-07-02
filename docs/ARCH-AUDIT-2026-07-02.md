# 架構稽核 2026-07-02

> 背景：~25 個功能兩天內陸續 merge 進 `develop` 後的健檢，回答「還足夠乾淨簡潔有邏輯嗎？沒有重複的部分吧？」。
> 本文記錄稽核範圍、已直接套用的安全清理（見對應 commit），以及需要人工判斷、故只記錄建議、未動手的項目。

## 總評

**整體乾淨程度：良好（B+ / 不錯，但 AnalyzerView 已接近該拆的臨界點）。**

- 沒有發現孤兒 i18n key、孤兒 export、失效 import、殘留的已刪除元件檔（CornerSpeedPanel /
  GgPanel / sector-suggestion 層皆確認完全清除，取代者有清楚的交叉引用註解）。
- store 層紀律良好：三個 store 的 `watch` 都是「自己的狀態 → localStorage/idb 持久化」這種
  單向鏡像，不是跨 store 寫入；`useCircuitPersistence.ts` 甚至在文件裡明確點名並排除了
  「watcher 寫另一份 store 狀態」這個 #9-desync 反模式。沒有發現雙重擁有者的狀態。
- 找到並修好了一處真的重複：`sectorValidity.ts` / `sectorTiming.ts` / `gateOrder.ts` 三個模組
  各自複製「per-gate 平面投影 + 依序走訪 lap 找 gate 跨越」的迴圈；`useLaps.ts` 也內嵌了一份與
  `cornerSpeed.ts` 的 `resolveSpeedChannel` 逐字重複的 fallback 邏輯。兩處都已抽取/統一（見下）。
- `AnalyzerView.vue`（655 行）身兼十種職責的協調層，是目前最大的架構壓力點，但沒有明顯的
  「零風險搬移」可做——大多數 computed 要嘛跨多個消費者（如 `trackExtrema` 同時餵 TrackMap 與
  TrackChannelPanel），要嘛牽涉到文件裡明訂的「AnalyzerView 是選圈↔縮放副作用的唯一決策點」
  這條architectural invariant，硬搬會犧牲那條規則的完整性。留作建議，未動手。
- 文件（DESIGN.md §11b、ARCHITECTURE-FORMATS.md §6）有兩處明顯落後於實作的敘述，已修正
  （見對應 commit）；不影響程式碼行為。

## 已套用的變更（機械式、行為不變、每步都跑過全部測試）

1. **`refactor(analysis): 抽取共用 gate-crossing 走訪原語 walkLapGates`**
   - `src/domain/analysis/laps.ts` 新增 `planarGate()` + `walkLapGates()`。
   - `sectorValidity.ts`／`sectorTiming.ts`／`gateOrder.ts` 改用共用原語（`gateOrder.ts` 只重用
     `planarGate()` 做投影 precompute，走訪迴圈本身保留——見下方「刻意不做」）。
   - 34 個既有測試案例（sectorValidity/sectorTiming/gateOrder）+ 全專案 509 測試綠燈。

2. **`refactor(composables): useLaps 統一改用 resolveSpeedChannel`**
   - `src/composables/useLaps.ts` 改呼叫 `cornerSpeed.ts` 的 `resolveSpeedChannel()`，移除內嵌的
     `GPS_Speed → Vehicle_Speed` fallback複製品；同步修正 `AnalyzerView.vue` 裡方向寫反的註解。
   - 全專案 509 測試綠燈。

3. **`docs: 修正已過時的規劃/待辦敘述`**
   - `ARCHITECTURE-FORMATS.md` §6：`parseBinary`/`headBytes` 從「規劃中」現在式改為「已落地」，
     並列出三個已用它的二進位 importer。
   - `DESIGN.md` §11b：「Sector 完整性判定有效圈」與「E 圈次分析（optimal/delta）」兩項待辦，
     實際上都已實作且已接 UI，改標記 `DONE` 並附程式碼交叉引用（比照文件中既有的
     刪除線+DONE寫法）。

## 刻意不做的機械化（已評估，判斷「硬套會犧牲清晰度」）

- **`gateOrder.ts` 的 `gatePositionOnLap` 走訪迴圈**：只重用了 `planarGate()` precompute，
  迴圈本身沒有改用 `walkLapGates`。原因：這個函式需要巡覽 lap 裡「每一個」有效樣本點以計算
  nearest-point fallback（不只是 crossing 那一刻），且在第一個 crossing 就提早 return——跟
  `walkLapGates`「只在 crossing 時 callback、依序推進單一 gate pointer直到耗盡整個 gates 陣列」
  的走訪語意本質不同。硬塞共用函式需要額外的「visit-every-sample」callback 或回傳早退旗標，
  複雜度增加但換不到少寫幾行的好處。

## 需要人工判斷的項目（僅記錄建議，未套用）

### 1. `AnalyzerView.vue`（655 行）的職責拆分

目前身兼：
1. 檔案選擇 toolbar + X 軸切換
2. TrackMap 整體 wiring（highlightLaps／focusRange／gates／heatmap legend markup）
3. 選圈↔縮放耦合的副作用中樞（`onLapSelect`／`onXZoom`——文件明訂這是刻意的單一決策點）
4. 圈速時間帶過濾 UI（`bandMin`/`bandMax`/`onBandInput`，含 inline template）
5. SectorPanel wiring（`sectorInvalidCount`）
6. A9 軌跡通道極值（`trackExtrema`／`mapExtremaMarkers`／`trackChannelChosen`）——**同時餵給
   TrackMap 與 TrackChannelPanel 兩個消費者**，不能直接搬進任一個 panel
7. 軌跡熱力上色（`heatNorm`／`colorValues`／`legendGradient`／`fmtVal`）——legend 的 markup
   直接寫在 AnalyzerView 的 template 裡（`.tc-legend`），不是委派給某個 panel 元件
8. 加速測試（`accelResult`／`onAccelFocus`）——`onAccelFocus` 呼叫 `analyzer.setXRange` +
   `lapStore.clearSelection()`，屬於第 3 點「唯一決策點」invariant 的一部分
9. 圖表清單渲染 + 新增圖表選單（timeseries／scatter）
10. `useCircuitPersistence()` 啟動註冊

**為什麼沒有直接動手**：檢查了「一個 computed 只有一個消費者就搬進那個 panel」這條零風險準則，
發現能滿足此準則的候選很少——`trackExtrema` 跨兩個消費者、`heatNorm`/`legendGradient` 的渲染
留在 AnalyzerView 自己的 template（沒有委派對象可搬入）、`accelResult`/`onAccelFocus` 雖然只有
`AccelTestPanel` 用，但 `onAccelFocus` 屬於「AnalyzerView 是縮放副作用唯一決策者」這條已經寫進
`架構原則（批次 R 後的鐵則）`（DESIGN.md 第 375 行）的規則的一部分，搬走會製造第二個決策點。
另外觀察到：多數 panel（`AccelTestPanel`／`LapAlignPanel`／`MapAlignPanel`／`SectorPanel`／
`TrackChannelPanel`／`TrackFilePanel`／`LapTable`／`ScatterChart`／`TimeSeriesChart`）已經直接
`import` 各自需要的 store，AnalyzerView 並非嚴格的「唯一 wiring 層」，所以拆分沒有一個乾淨、
一致的目標形狀可以機械套用。

**建議方向（下次要做時）**：
- 把「軌跡熱力上色」一組（`heatNorm`/`colorValues`/`legendGradient`/`fmtVal`/legend markup）
  抽成一個 composable（如 `useTrackHeatmap(session, track, trackChannel, trackColormap,
  trackColorEnabled)`），回傳值同時餵 TrackMap 的 prop 與一個新的 `<TrackHeatmapLegend>`
  展示元件——這組本來就相對自包含，唯一障礙是 legend markup 目前是 inline template。
- 把「A9 極值」一組（`trackChannelData`/`trackExtrema`/`mapExtremaMarkers`/`trackChannelChosen`）
  抽成 `useTrackExtrema(session, track, trackChannel, focusedLap, markMinima, markMaxima)`，
  因為它本質上是「給定 session+track+channel+lap，算出極值」的純衍生邏輯，只是恰好有兩個
  消費者——composable 抽出去後兩個消費者都改成從同一個 composable 讀，而不是搬進某一個 panel。
- 「選圈↔縮放耦合」這條 invariant 建議保持現狀（AnalyzerView 是唯一決策點），不要拆。

### 2. Gesture 狀態機：`TrackMap.vue` vs `UPlotChart.vue`（report-only，評估為不值得抽）

兩者形狀相似：都用 `pointers`/`touchPointers: Map<number, {x,y}>` + `mode`/`touchMode`
狀態機（`idle`/`pan`/`pinch`，TrackMap 多一個 `line` 拖曳把手模式）+ 幾乎一致的
`onPointerDown`/`onPointerMove`/`onPointerUp`/雙指偵測邏輯骨架
（`src/features/analyzer/TrackMap.vue:601-798`、`src/components/UPlotChart.vue:133-278`）。

**評估結論：不值得抽。**
- **語意不同**：TrackMap 做的是 2D 地理投影平移/縮放/拖把手（`projection.toGeo`/`toPixel`），
  UPlotChart 做的是 1D X 軸範圍縮放（`posToVal`/`valToPos` + uPlot 的 scale API）。真正的數學
  （`pixelShift`/`clampPan`/`fitToFocus` vs `panRange`/`pinchRange`/`dataXBounds`）幾乎沒有重疊，
  硬抽出來的「共用狀態機」只會剩下 Map 宣告+ mode 列舉這種骨架，實質邏輯還是要在各自的
  callback 裡重新分流，抽象层级不上不下。
- TrackMap 額外有 `'line'` 拖曳模式（起終點線/gate 把手），UPlotChart 沒有這個概念——共用型別
  要嘛塞一個永遠用不到的 variant 進 UPlotChart，要嘛用泛型硬撐，兩者都增加閱讀成本。
- 若真的要抽，建議方向是抽一個**極薄**的「雙指/單指 pointer 分類器」（輸入
  pointerdown/move/up 事件+pointers Map，輸出「這是 pan 手勢還是 pinch 手勢，pinch 的話中心點
  跟距離是多少」），把「這個手勢代表什麼動作」完全留給呼叫端決定——但這個抽象的 ROI 該不該做，
  取決於未來還會不會有第三個手勢消費者；只有兩個且語意分岔這麼大時，現狀的重複是可接受的
  「兩份各自完整、可獨立理解」優於「一份難懂的共用抽象」。

### 3. 大型元件觀察（非重複，僅供參考）

- `TrackMap.vue`（890 行）：`draw()` 函式本身就 ~370 行，但是內聚的——全部都是同一個 canvas
  的繪製邏輯（軌跡線/熱力/起終點線/gate/極值標記/游標），沒有明顯可拆的職責邊界，不建議拆。
- `GearPanel.vue`（562 行）／`LapTable.vue`（586 行）：大，但都是單一 panel 自身的完整功能
  （不是像 AnalyzerView 那樣的多 panel 協調層），大小本身不是壞味道。

## 稽核方法

- 已知嫌疑犯（sectorValidity/sectorTiming/gateOrder 幾何重複、resolveSpeedChannel 系列、
  AnalyzerView 職責、gesture 狀態機）：逐一讀原始碼 + 對應測試檔，人工比對。
- i18n / 死碼 / 孤兒 export / 失效 import：委派給一個唯讀的 sub-agent 做逐 key grep 驗證
  （結論：無孤兒 i18n key、無孤兒 export、無失效 import、無殘留的已刪除元件檔）。
- store watcher 稽核：讀了所有 `stores/*.ts` 與 `composables/*.ts` 裡的 `watch(...)` 呼叫點，
  確認每個都是單向（自身狀態→持久化，或明確標註"just the feed"的 push-only 模式），沒有發現
  雙重擁有者或跨 store 互相覆寫的情況。

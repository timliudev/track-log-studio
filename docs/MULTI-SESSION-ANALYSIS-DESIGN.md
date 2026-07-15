# 多軌跡檔同時分析 + 全域疊加分析 — 設計文件

**範圍**：純設計，不含任何功能程式碼變更。對應需求 #7「多個軌跡檔同時分析
（含 offset 偏移對齊）」與 #8「疊加分析全域化」——目標是把目前「賽道地圖
才有的多檔疊圖」擴展到時序圖、XY 散佈圖、圈次表全部卡片。

分支 `docs/multi-session-design`，從 `develop` HEAD `54c81af` 切出（`git log
--oneline -1` 可驗證）。本文件只回答「現況是什麼、目標模型是什麼、怎麼分階段
做」，不做任何 store/component 的實作變更。

> **實作現況更新**：本文件規劃的 Phase 1–4 之後都已實作並合併——
> `analyzerStore.selectedSessions` + `useSessionComparison`（Phase 1，時序圖
> 多檔疊線）、`TrackMap`/`ScatterChart`/`GgChart` 的 comparison-session 疊圖
> 與 offset（Phase 2）、圈次表跨檔比較（Phase 3——最終採用**逐圈完整併列表格**
> `SessionLapComparison.vue` / `buildComparisonLapRows`，比本文件 §7 Phase 3
> 當時建議的「唯讀摘要行」更完整，屬於後續拍板的產品決策更新）、以及跨檔選圈
> 疊圖＋疊圖↔地圖游標連動（Phase 4，`crossSessionLapOverlay.ts` /
> `crossSessionLapHighlight.ts` / `overlayCursor.ts`）。本文件以下內容保留作為
> **設計理由與資料模型的歷史紀錄**，各節描述的「現況」多半已是「當時的現況」
> 而非目前程式碼現況，請以 §7 對照上述已完成項目閱讀。

---

## 0. 一句話結論

現況只有「賽道地圖」（#2，`useTrackOverlay.ts` / `TrackMap.vue`）做到了多檔
疊圖，而且是**純視覺、零對齊**的最簡形式（其他檔案的 GPS 軌跡用固定色盤畫在
地圖上，沒有時間/距離對齊，也不能微調）。時序圖、XY 散佈圖、圈次表、
sector、加速測試、齒比、避震全部只認 `analyzerStore.activeFileId` 這一個
「當前作用中的單一 session」。offset（`lapStore.offsets`）目前是**同一個
session 內、按圈微調**的機制，與「跨檔對齊」完全是兩回事，不能直接照搬，但
其 API 形狀（時間/距離/地圖三軸分開微調 + 手動 nudge，無自動偵測）是很好的
參考藍本。

建議的第一階段不是「先做完整的 session 多選 store」，而是**把 store 骨架
（最小必要欄位）跟「時序圖 timeline 模式多檔疊線」在同一個階段一起做**——
理由見 §7。

---

## 1. 現況架構盤點

### 1.1 資料流總覽

```
FileBar.vue ──import──▶ fileStore (Pinia)
                          ├─ files: ImportedFile[]           (per-file 中介狀態)
                          └─ sessions: Map<id, LogSession>    (per-file 原始資料，非響應式)

analyzerStore (Pinia, 全域/裝置層級狀態)
  ├─ activeFileId: number | null      ← 唯一的「目前作用中 session」指標
  ├─ overlayFileIds: number[]         ← 只給賽道地圖用的「其他檔案疊圖」開關集合
  ├─ xAxis: 'time' | 'distance'       ← 全域共用
  ├─ charts: ChartConfig[]            ← 圖表卡片存在與否 + 設定（持久化，見 §8）
  ├─ xRange / cursorIdx / overlayCursorIdx  ← 共用縮放/游標狀態
  └─ trackChannel / accelCondition / …      ← 其他全域面板狀態

useActiveSession()  ← 全站唯一的「作用中 session」衍生點
  session = fileStore.getSession(analyzer.activeFileId)
  track   = extractGpsTrack(session)
  xValues = time 或 distance（依 analyzer.xAxis）

useLaps() / lapStore / sectorStore
  ← 全部只認 useActiveSession() 給的 track/session；圈次 index、offsets、
    選取/排除全部是「這個 session 的第 N 圈」，檔案一切換就整組清空
    （useLaps.ts 的 watch(track, …) 會 clearSelection/clearExcluded/
    clearOffsets）

useTrackOverlay()  ← 唯一的多檔功能：從 overlayFileIds 找出「其他已載入且有
                      GPS 的 session」，抽稀後給 TrackMap 疊畫
```

### 1.2 per-file / per-lap / per-circuit 狀態盤點表

| 狀態 | 範圍 | 位置 | 備註 |
|---|---|---|---|
| 原始解析資料 (`LogSession`) | **每個檔案**各自一份 | `fileStore.sessions` (Map) | 所有已匯入檔案都同時留在記憶體，不只 active 的那個 |
| `activeFileId` | 全域單一指標 | `analyzerStore` | 驅動 `useActiveSession` |
| `overlayFileIds` | 全域集合，**只被地圖消費** | `analyzerStore` | 不持久化（transient） |
| `charts[]`（存在與設定） | 全域（裝置偏好，非跟著檔案走） | `analyzerStore` + `chartConfigs.ts` | **持久化**於 `aracer-loga.analyzerCharts.v1`，換檔案不會變 |
| `xRange` / `cursorIdx` | 全域，語意綁在 active session 的 index 空間 | `analyzerStore` | 換檔會失真（見 §1.3） |
| `lapStore.line`（起跑線）/ `sectorStore.gates` | **每個賽道（GPS circuit key）**各一份 | `lapStore` / `sectorStore`，經 `useCircuitPersistence.ts` 用 `circuitKey(track)` 存取 idb | 同一賽道、不同檔案切換時會**自動還原**同一組線/gates——這對「同賽道多檔比較」是利多 |
| `lapStore.selected` / `manualExcluded` / `offsets` | **每個 session 的圈次 index**，檔案一換就整組清空 | `lapStore` | `offsets: LapOffset{time,dist,mapX,mapY}`，見 §1.4 |
| `dashboardLayout.v1` / `panelState.v1` / `layoutLocked.v1` | 全域（裝置偏好） | localStorage | 卡片位置/收合/釘選/鎖定，與載入哪個檔案無關 |

**關鍵觀察**：`fileStore` 早就是「多檔」的（`readySessions`/`readyFiles` 本
來就回傳所有已匯入檔案），真正把資料流收斂成「單一」的收斂點只有
`analyzerStore.activeFileId` → `useActiveSession()` 這一條線。換句話說，
**資料層不需要大改，需要改的是「誰讀 activeFileId」這件事要變成「誰讀
selectedSessions[]」**。

### 1.3 各卡片如何消費 `activeFileId`

| 卡片 | 消費方式 | 對「多檔」的天然難度 |
|---|---|---|
| `TrackMap.vue` | `track`（active，全解析度）+ `overlayTracks`（其他檔案，抽稀，純視覺疊圖，**已支援多檔**） | 低——只差「offset 對齊」這一塊尚未做（§1.5） |
| `TimeSeriesChart.vue`（timeline 模式） | 單一 `session` prop，`props.xValues` + 逐 channel 畫線，色盤用 array index（PALETTE，非 session 色） | 低——沒有圈次概念，是本文件建議的第一階段切入點（§7） |
| `TimeSeriesChart.vue`（overlay 模式） | 單一 `session`，把 `lapStore.selected` 的圈（`Lap.index` 只在這個 session 內有意義）重基準到 0 後疊畫，色=圈、線型=channel（`buildLapOverlay`） | **高**——要跨檔選圈，`Lap` 的身分要從純 `index` 升級成 `{fileId, index}`，牽動 `lapStore`/`LapTable`/`MapAlignPanel`/`LapAlignPanel`/`buildLapOverlay` 全部（見 §7 Phase 4） |
| `ScatterChart.vue` / `GgChart.vue` | 單一 `session`，無圈選取時整個 session 一個點雲，有圈選取時每圈一個點雲（色=圈序） | 中——可以先做「每 session 一個點雲」不牽涉圈次身分 |
| `LapTable.vue` | 單一 `session` 的 `laps`，欄位設定全域但值算在 active session 上 | 中高——「併不併列多檔」是開放問題（§9） |
| `SectorPanel.vue` | 單一 `session` 的 laps + `sectorStore.gates`（per-circuit） | 同上 |
| `TrackChannelPanel` / 熱力圖 / 極值標記 | 單一 `session`，且極值只在**剛好選 1 圈**時算 | 高——極值/熱力圖語意本來就是「單一連續資料」，多檔疊加意義不明確，建議排除在本次範圍外 |
| `AccelTestPanel` / `GearPanel` / `SuspensionCard` | 單一 `session` 的整段搜尋/校正 | 高——這些是「深挖單一 session」的分析工具，多檔比較意義薄弱，建議維持 primary-only |

### 1.4 offset 現況：`lapStore.offsets`（同 session 內按圈微調）

```ts
export interface LapOffset {
  time: number   // 時序圖 X 軸微調（依 xAxis 為 time 或 distance 各自一個欄位）
  dist: number
  mapX: number   // 地圖位置微調（公尺，east+/north+）
  mapY: number
}
```

- Keyed by 「這個 session 的第 N 圈 index」（`Record<number, LapOffset>`），
  **檔案一切換就整組清空**（`useLaps.ts`）。
- 對齊方式是**純手動**：`LapAlignPanel` / `MapAlignPanel` 提供 nudge 按鈕，
  沒有任何自動偵測「兩圈哪裡對得上」的演算法——`nudgeOffset(index, axis,
  delta)` / `nudgeMapOffset(index, dx, dy)`，使用者自己按到肉眼對齊為止。
- 套用位置：
  - **時序圖 overlay 模式**：`buildLapOverlay` 把每圈的 X 重基準到 0
    後再加 `offsetOf(lap.index, xAxis)`，接著在共用的 lap-relative grid
    上重取樣（線性內插）。
  - **地圖**：`TrackMap.vue` 的 `pixelShift()` 把 `mapOffsetOf(lap.index)`
    的公尺位移換算成當下投影比例尺下的固定像素偏移，疊加在該圈的
    `strokeRange` 上。

**這個機制的可複用之處**：三軸分離（時間/距離/地圖）、手動 nudge、
reset-per-axis 的 API 形狀已經被使用者用過、驗證過。**新的「跨 session
offset」建議照抄這個形狀**，只是 key 從「圈次 index」換成「檔案 id」（見
§4）。

### 1.5 賽道地圖疊圖（#2）現況細節

`useTrackOverlay.ts` + `TrackMap.vue` 的疊圖是目前唯一的「多檔」實作，值得
完整記錄其設計，因為它是本次擴展的直接參考：

- **色盤**：`categoricalColor(fileStore id)`（`domain/analysis/colorPalette.ts`
  的 `CATEGORICAL_COLORS`，8 色手選色相）。color 用 **file id** 當 key，不
  是「開關順序」——這代表同一個檔案不管被開關幾次，顏色永遠固定，這是好的
  設計，應該原樣沿用到全域。
- **⚠ 同一色盤也是 `lapColor`（圈次身分色）的來源**（`lapColors.ts` 直接
  re-export `categoricalColor`）。目前兩者不會同框衝突，是因為地圖疊圖畫的
  是「其他檔案」、`highlightLaps` 畫的是「active session 的圈」，語意上不
  會同時出現同一個「順位」。但**多檔 + 多圈同時疊加時，這兩套「第 N 個東西
  是什麼顏色」系統會爭用同一組 8 色**——見 §5 的色盤衝突處理建議。
- **抽稀**：`decimateGpsTrack(track, 1000)`——固定 stride 抽樀（非
  LTTB，因為軌跡是封閉 2D 曲線沒有可供 LTTB bucket 的單調軸），只用於
  **其他**檔案的軌跡，active session 自己的軌跡永遠全解析度畫。
- **零對齊**：目前疊圖**完全沒有 offset 概念**——所有其他檔案的軌跡就是
  用各自的原始經緯度直接投影疊在同一張地圖上（`fitProjection` 會把
  active track + 所有 overlay tracks 的合併 bbox 一起納入考量再做一次
  仿射投影）。這在「同賽道」的前提下通常已經夠用（GPS 座標本身就是絕對
  地理座標，兩次紀錄理論上會自然重合），只有 GPS 漂移的情況需要微調，而
  目前**沒有任何「per-session 地圖微調」入口**——`lapStore.mapOffsetOf`
  只認「當前 session 裡的第 N 圈」，跟疊圖用的「file id」完全是兩套 key。
- **繪製順序**：疊圖線一律先畫（`OVERLAY_ALPHA=0.45`、`OVERLAY_LINE_WIDTH
  =1.5`），active session 自己的軌跡/熱力圖/選取圈/起跑線/gates/極值/游標
  全部後畫，確保 active 永遠在最上層、最顯眼。
- **圖例/開關 UI**：目前就地嵌在 `TrackMap` 這張卡片的 footer 裡（一排
  checkbox + 色塊 + 檔名 + 全部清除按鈕），**不是全域工具列的東西**——這點
  在 §5 會建議挪動。

---

## 2. 目標模型

### 2.1 核心概念：primary session + selectedSessions[]

```ts
// 概念示意，非最終程式碼
interface SessionSelection {
  fileId: number
  color: string          // categoricalColor(fileId)，全站唯一色彩來源
  offset: {
    timeSec: number       // 時序圖 timeline 模式 X 軸微調（秒）
    distM: number         // 時序圖 timeline 模式 X 軸微調（公尺）
    mapX: number          // 地圖微調（公尺，east+）
    mapY: number          // 地圖微調（公尺，north+）
  }
  visible: boolean         // 是否目前疊加顯示（vs. 已加入清單但暫時關閉）
}
```

- **primary session**：維持現有 `analyzerStore.activeFileId` 不變——它已經
  是「圈次表 / sector / 齒比 / 避震 / 加速測試 / 熱力圖與極值 / 起跑線與
  gates 的還原基準」，這些卡片的語意本來就是「深挖單一 session」，沒有
  自然的多檔擴展方式（見 §1.3 的難度評估），**不建議廢除或稀釋 primary 的
  概念**，只需要把它的角色講清楚：primary = 這些卡片唯一認得的 session；
  time series / XY / 地圖則同時認得 primary + 所有 `selectedSessions`。
- **selectedSessions[]**：取代/擴充現有 `overlayFileIds`——語意從「只給
  地圖用的疊圖開關」升級成「全域比較清單」，同一份清單被地圖、時序圖、
  XY 散佈圖三張卡片共用。primary session 不需要（也不應該）出現在這份清單
  裡——它永遠是「基準/全解析度」的那一個，`selectedSessions` 只裝**其他**
  檔案，這點完全比照現有 `overlayFileIds` 已經在做的「排除 activeFileId」
  規則（`useTrackOverlay.ts` 的 `candidates` computed）。
- **主檔切換（B55，已實作）**：primary 不鎖定在第一個載入的檔案。FileBar
  每個非主檔的 ready pill 提供常駐星形「設為主要記錄」按鈕（coarse pointer
  下 44px，DESIGN.md §8；點檔名亦可觸發），純邏輯在
  `domain/analysis/sessionSelection.ts` 的 `promotePrimarySession`。切換時
  `lapStore.swapPrimarySession`（純函式 `domain/analysis/primaryLapSwap.ts`）
  把 index-keyed 的 primary 圈狀態（選圈/手動排除/對位偏移）與 fileId-keyed
  的 per-session 狀態雙向遷移；起跑線、sector gates、有效圈 band 視為全域
  共用狀態，切換不重置（`primarySwapPending` 一次性訊號讓
  useLaps/useSectors 的換檔清空 watcher 跳過該次）。取消勾選主檔的自動升級
  與移除主檔檔案的自動升級也走同一條遷移。

### 2.2 各卡片在目標模型下的行為

| 卡片 | 目標行為 |
|---|---|
| **地圖** | 不變（已完成），加上：`selectedSessions[i].offset.mapX/mapY` 可微調（新增），圖例挪到全域（§5） |
| **時序圖 timeline 模式** | primary 的每個選取 channel 疊加畫出 `selectedSessions` 中每個 session 的**同名 channel**（若該檔沒有這個 channel，比照現有「channel 不存在就不畫」的既有容錯規則，靜默略過），色＝session 身分色，線型可選擇沿用「色=session、統一實線」或「色=session、dash=channel」（見 §7 Phase1 的視覺決策） |
| **時序圖 overlay 模式** | **本次範圍不擴充**（見 §1.3 難度評估 + §7 Phase 4）；短期維持「只能疊同一個 session 內的圈」 |
| **XY 散佈圖 / G-G** | 每個 `selectedSessions` 成員貢獻一個點雲 series（整個 session，或該 session 若也有自己的圈選取邏輯——本次不做跨檔圈選取，故只支援「整個 session」一種點雲），色＝session 身分色 |
| **圈次表** | **不做逐檔併列**（開放問題，見 §9），改為每個 `selectedSessions` 成員在表格旁提供一行「最快圈時間 + 與 primary 最快圈的 delta」的唯讀摘要 |
| **Sector 面板** | 同圈次表，維持 primary-only，可選加一行「vs 比較 session」摘要 |
| **熱力圖/極值/齒比/避震/加速測試** | **維持 primary-only**，不擴充 |

---

## 3. 對齊 / offset 策略

### 3.1 為什麼不能直接搬 `lapStore.offsets` 那一套

`lapStore.offsets` 的 key 是「當前 session 的第 N 圈」，且**多圈疊加的前提
是每圈都先重基準到自己的起點（X=0）**——`buildLapOverlay` 靠這個「圈自己的
相對座標」才能把不同長度的圈畫在同一張圖上。這套機制天生就是
「lap-relative」的，不是「session-relative」的。

Timeline 模式（多檔疊加的主要場景）畫的是**整段 session 的原始時間/距離
軸**，沒有「圈」這個中介單位，所以需要一個新的、以**檔案**為 key 的 offset
結構，而不是延用「圈次」的 key。

### 3.2 新增：per-session offset（比照 `LapOffset` 的形狀，key 換成 fileId）

```ts
interface SessionOffset {
  timeSec: number   // xAxis === 'time' 時的 X 軸微調
  distM: number     // xAxis === 'distance' 時的 X 軸微調
  mapX: number       // 地圖微調（公尺 east+）
  mapY: number       // 地圖微調（公尺 north+）
}
```

- API 形狀直接比照 `lapStore` 現有的 `offsetOf` / `nudgeOffset` /
  `resetOffset` / `mapOffsetOf` / `nudgeMapOffset` / `resetMapOffset`
  ——只是引數從 `lap index` 換成 `fileId`，讓熟悉現有「圈次對齊」UI 的使用
  者可以無痛套用到「檔案對齊」UI（甚至可以共用同一組 `LapAlignPanel` /
  `MapAlignPanel` 的元件邏輯，改個 prop 而已）。
- **持久化**：`overlayFileIds` 目前是 transient（不持久化，模組註解明講
  「Transient like the other analyzer toggles above」），而 `fileStore` 本身
  也完全沒有跨重整持久化（檔案是每次開頁重新匯入的，`nextId` 每次都從 1
  開始）——**因此 `SessionOffset` 沒有必要跨重整持久化，維持跟
  `overlayFileIds` 一樣的 transient 等級即可**，不需要另外設計以
  circuit-key 為基礎的持久化方案（也避免了「fileId 不穩定，無法跨重整當
  persistence key」的麻煩）。

### 3.3 對齊的預設值：時序圖 timeline 模式怎麼決定「0 offset」代表什麼

這是本文件唯一需要拍板的「演算法」決策，列出建議值與備選：

| 方案 | 說明 | 優缺點 |
|---|---|---|
| **A（建議值）：以各檔自己第一次通過起跑線的時刻/距離為零點** | 每個 session 各自跑一次 `detectLapsByLine`（或既有 ECU 圈數），取「第 1 圈起點」的 time/distance 值當作該檔的隱性零點，疊加時等於「先各自扣掉這個值，再套用使用者手動微調」 | 對「同賽道不同天」的比較，這個預設幾乎都是合理的起點；成本極低（`detectLapsByLine` 大檔僅 1.7ms，見 §6）；**缺點**：起跑線位置因人而異，若兩個檔案的起跑線沒設在同一個實體位置，這個「零點」仍然只是同一個檔案自己的圈 1，不代表兩檔真的對齊——仍需要使用者手動微調收尾 |
| B：以各檔 log 起點（session 內部 t=0 / 第一筆有效 GPS）為零點 | 完全不做任何偵測，兩檔的「session 開始錄製」時刻直接對齊 | 實作最簡單（offset 預設值永遠是 0）；**缺點**：兩次外出時間、暖胎圈長度幾乎不可能一樣，這個預設幾乎必然是錯的，每次比較都要重新手動對齊，體驗差 |
| C：純手動，不给任何智慧預設 | 比照 `lapStore.offsets` 現有精神（該功能本來就沒有自動偵測），新增檔案時 offset 一律是 0，全部交給使用者用 nudge 按鈕 | 實作風險最低，行為與現有 #9 完全一致；**缺點**：與方案 B 的「錯誤但仍是 0」相同體驗問題，只是解釋成「本來就不打算幫你猜」 |

**建議**：採方案 A 當預設值，因為它幾乎零成本（複用既有 `detectLapsByLine`
/ ECU 圈數偵測，不需要新演算法）、且大幅降低「每次疊加都要手動對齊」的
挫折感；同時**保留使用者手動 nudge 覆寫**（方案 A 只決定「加入比較清單時
的初始 offset」，不影響後續微調能力）。方案 C 留作「若 A 的偵測在特定檔案
上失準」時的保底行為（例如該檔沒有 GPS/沒有起跑線可偵測時，直接退回 0，
這本來就是 A 在「偵測不到」情況下的自然結果，不需要另外實作切換）。

地圖 offset（`mapX`/`mapY`）維持**預設 0**（方案 B/C 的邏輯）——因為兩次
紀錄的 GPS 絕對座標本來就該自然重合（現有 `TrackMap` 疊圖已經是這樣運作且
「通常已經夠用」，見 §1.5），只有 GPS 漂移時才需要使用者手動微調，不需要
額外的自動偵測。

### 3.4 UI 位置

比照 §1.5 最後一點的建議，把「比較 session 清單 + 每個成員的 offset 微調」
從 `TrackMap` 卡片挪到 `AnalyzerView` 頂部工具列（與現有「記錄」下拉選單、
時間/距離切換鈕同一排或緊鄰），成為一個全域小面板（可收合），內容：

- 每列一個已選比較 session：色塊（=身分色）+ 檔名 + 顯示/隱藏開關 + 移除
- 展開後：時間/距離 offset 的數值輸入 + nudge 按鈕（±0.1 / ±1 秒或公尺）
  + 重設按鈕（比照 `LapAlignPanel`/`MapAlignPanel` 現有 UI 語彙）
- 地圖 offset（mapX/mapY）微調可以維持在地圖卡片內（因為那是「看著地圖對
  齊」的操作，移出地圖卡片反而不直覺），但**清單本身/顯示開關**搬到全域

---

## 4. 色盤 / 圖例

- **色彩來源統一**：全部使用 `domain/analysis/colorPalette.ts` 的
  `categoricalColor(fileId)`，與現有地圖疊圖完全一致，不另外設計新色盤。
- **⚠ 衝突處理**：`lapColor`（圈次身分色，`order` 為 key）與
  `categoricalColor`（session 身分色，`fileId` 為 key）**共用同一組 8 色**
  （`lapColors.ts` 直接 re-export）。當畫面上同時出現「N 個 session」與
  「M 個圈」時（例如未來 Phase 4 的跨檔選圈），會有兩套「第 3 個東西是什麼
  顏色」互相打架的風險。**建議規則**：多 session 疊加時，**色相永遠代表
  session**；圈次身分改用**線型/透明度**區分（比照現有 overlay 模式已經
  在用的「色=圈、dash=channel」語言，對調成「色=session、dash或透明度=
  圈」），避免新增第二組獨立色盤搶佔同一組視覺資源。
- **B25 — XY 散佈圖第三軸 vs. 多檔識別，已拍板**：上一點預告「這一點在
  Phase 2（XY 散佈圖）就會第一次真正遇到」的衝突，實際發生的形式是：
  散佈圖的**顏色軸**（可選第三 channel，連續 colormap 上色）本身也要用
  「色相」，一旦多選了第二個比較檔案，色相就同時被「session 身分」與
  「第三軸數值」兩邊搶——**已拍板的解法是把色相完全讓給第三軸**（單檔、
  多檔皆然：`multiSessionScatter.ts` 的 `colorChannel` 一旦給值，所有
  session 都輸出 `colorValues`，`GgChart.vue` 的 `visualMap` 對全部
  series 生效），**檔案識別改用「標記形狀」**（`domain/analysis/
  markerShapes.ts` 的 `markerShapeForIndex`：依比較列表**位置**指定
  circle/triangle/rect/diamond/pin/arrow，不是用 `fileId`），並在
  `GgChart.vue` 內用 ECharts 內建 `legend`（icon 直接取 `symbol`
  字串——ECharts 的 marker 與 legend icon 共用同一組符號名稱）畫出「形狀
  →檔名」對照，只在「顏色軸啟用且確實出現一種以上形狀」時才顯示（見
  `shouldShowMarkerLegend`），避免單檔散佈圖多一個沒必要的圖例。**第三軸
  未啟用時，多檔仍維持本節原規則（色相＝session 身分）不變。**
- **圖例呈現**：單一、全域、可收合的比較面板（§3.4），是「session 身分色」
  的唯一圖例來源；各張圖表卡片本身**不重複畫色塊清單**，只在資料上套用
  對應顏色（與現有「圈次表用色塊代表選取圈」的做法一致：色塊清單只在
  一個地方，其他地方只呈現已上色的資料）。**例外**：上述 B25 的「形狀
  圖例」——一旦顏色軸啟用，色相就不再代表 session 身分，全域比較面板的
  色塊也就不再是「這個形狀是哪個檔」的答案，因此形狀圖例改在 `GgChart.vue`
  卡片內就地呈現，是這條「唯一圖例來源」規則刻意保留的例外。

---

## 5.（原文件結構中的「效能影響」移到 §6，此處保留章節編號一致性，故略過）

---

## 6. 效能影響評估

引用本機效能量測筆記（大檔基準：39.16MB / 57,594 rows / 272 channels）：

### 6.1 「多檔同時解析/持有」本來就已經在發生，不是新成本

`fileStore` 早就會把**所有已匯入檔案**的 `LogSession` 留在記憶體
（`sessions: Map`），不限於 active 的那個——這是賽道地圖疊圖 #2 已經在依賴
的前提。稽核報告 §1.6 的記憶體量測：單一 39MB 大檔的 Float32 資料本體約
61.9MB，且明確指出「單一 session 的資料量遠低於瀏覽器分頁記憶體上限……
真正該注意的是**多個 session 同時留在記憶體**」——這正是本次功能會加重的
場景，但以 3-4 個同賽道的比較檔案估算（~250MB 量級）仍在報告認定的「不用
擔心」範圍內，**記憶體不是本次設計需要特別防護的項目**。

### 6.2 真正的新風險：uPlot 一次被塞進 N 倍未抽稀的原始點

稽核報告 §1.5／§3／§4-1 的結論非常直接地點名了這個風險：

> 「`TimeSeriesChart.vue`（uPlot 時序圖）：無抽點……`downsample.ts` 裡有
> 一個寫好且有單元測試的 `lttb()`……但整個 `src/` 只有它自己的檔案、自己
> 的測試……生產程式碼完全沒有任何地方呼叫它」

> 「真正的風險在更長的 session……疊加多張儀表板卡片同時渲染時才會顯現，
> 屬於『目前沒事、但沒有安全網』的狀態」

目前單一 session 餵給 uPlot 的點數（大檔 57,594 點/線）已經處在「目前沒事
但沒有安全網」的邊緣；**本次功能第一次會讓 uPlot 在同一張圖上同時畫 primary
+ N 個比較 session 的同一個 channel**，等於把稽核報告點名的風險直接乘以
N。`ScatterChart`/`GgChart` 路徑則已經有 `MAX_POINTS=5000` 的抽點
（`buildGgPoints`），**這條路徑沒有大檔/多檔風險**，地圖疊圖路徑也已有
`decimateGpsTrack`（1000 點上限）。

**結論**：時序圖（timeline 模式）是唯一真正需要在本次一併補上抽點安全網
的地方。稽核報告自己給的優先建議 #1 正是「把 `lttb()` 接進
`TimeSeriesChart.vue`」，工時估 0.5–1 天、風險低，且原文建議「值得排進下
一輪技術債清單，因為之後有真的長 log 進來時，這是唯一目前完全空白的
防線」——本次多檔疊線正是那個「之後」提前到來的觸發點，**建議把這件事
納入 Phase 1 的完成定義（Definition of Done），而不是留到之後單獨立案**
（見 §7）。

### 6.3 計算管線本身（GPS track / laps / sectors 等）

稽核報告 §1.4：大檔整條計算管線（GPS track→laps→sectors→corners→GG→
suspension→輪胎倒算）全部加總 < 120ms，且都是「使用者主動觸發一次」而非
每幀重算。多檔會讓這些計算**乘以 N**（每個比較 session 都要各自跑一次
`extractGpsTrack`/`timeSeconds`/`detectLapsByLine` 等），但單項最貴的
`detectCorners`（~33ms）與輪胎倒算（~75ms）**都被限定在 primary-only**
（§2.2 已排除熱力圖/極值/齒比/避震/加速測試的多檔擴充），比較 session 只
需要 `extractGpsTrack`（4.1ms）+ `timeSeconds`（未量測但屬同量級的
elementwise 轉換）+ `detectLapsByLine`（1.7ms，若採 §3.3 方案 A 的 offset
預設）——即使 4 個比較 session 同時開，單次追加成本落在 ~30ms 級距，仍在
稽核報告認定的「不踩線」範圍內，**不需要特別優化**，但實作時建議比照
`useActiveSession` 現有的「每個 session 一組 computed」模式，用一個以
`fileId` 為 key 的快取（例如簡單的 `Map`/`WeakMap`）避免同一個比較 session
在同一次 re-render 週期內被重覆算兩次以上。

---

## 7. 分階段實作計畫

排序原則：**風險最低、對現有程式碼改動面最小的先做**；每個階段都要能
獨立通過測試、獨立產生使用者可感知的價值。

### Phase 1 — 資料模型骨架 + 時序圖 timeline 模式多檔疊線 + lttb 抽點安全網

**為什麼資料模型不單獨拆一個階段**：光是把 `overlayFileIds` 升級成
`selectedSessions[]` + 新增 `sessionOffsets` 這件事本身完全沒有使用者可見
的價值（現有地圖疊圖已經用舊模型跑得好好的），拆成獨立 PR 只會製造一次
「改了但看不出差異」的 review 負擔。時序圖 timeline 模式又是**改動面最小
的卡片**（不像 overlay 模式牽涉圈次身分、不像 XY 圖要處理色盤衝突、不像
圈次表要決定併不併列）——現有 `timelineData`/`timelineSeries` 已經是
「逐 channel 疊線、色盤 by array index」的結構，只需要把「陣列的外層維度」
從「這個 session 的 N 個 channel」擴充成「(session, channel) 的笛卡兒積」，
改動可控。

**內容**：
1. `analyzerStore`：新增/重命名 `overlayFileIds` → 語意擴充為全域
   `selectedSessions`（不再是「地圖限定」），新增 `sessionOffsets:
   Record<number, SessionOffset>` + nudge/reset actions（比照 `lapStore`
   現有 API 形狀，§3.2）。
2. 新 composable `useSessionComparison()`：取代/包裝現有
   `useTrackOverlay()` 的「找出候選檔案」邏輯，額外衍生每個比較 session 的
   `xValues`（已套用 `sessionOffsets` 的 time/dist offset）。
3. `TimeSeriesChart.vue` timeline 模式擴充：接受 `comparisonSessions` prop，
   為每個已選 channel 疊加每個 comparison session 的同名資料，色＝session
   身分色。
4. **同一階段內**把 `downsample.ts` 的 `lttb()` 接進 `timelineData`（依
   `xRange` 可視範圍 + 容器寬度抓目標點數），套用到 primary **與**每個
   comparison session——理由見 §6.2。
5. Overlay 模式、XY 圖、圈次表**本階段不動**。

**風險**：中低。第一次讓 `TimeSeriesChart.vue` 認識一個以上的
`LogSession`，但既有「channel 不存在就靜默略過」的容錯規則可以直接沿用到
「某比較 session 沒有這個 channel」的情境。

**測試**：`useSessionComparison` 單元測試（offset 套用、候選篩選、色彩
穩定性）；`lttb` 接線後的既有 `downsample.test.ts` 應該仍然全綠，另外補
「timeline 資料組裝在給定 xRange/寬度下確實呼叫 lttb 且點數有上限」的測試。

### Phase 2 — 地圖疊圖串接新 offset 模型 + XY/散佈圖多檔疊線

**為什麼這兩個綁一起**：地圖疊圖本身已經完成 90%（#2），這階段只是把
Phase 1 新增的 `sessionOffsets.mapX/mapY` 接進既有 `pixelShift` 機制（`
TrackMap.vue` 早就有這條路徑，只是目前只認 `lapStore` 的逐圈 offset），
改動面很小；XY 圖則是「比照時序圖 timeline 模式，做同一件事的第二次」，
兩者都建立在 Phase 1 的 `selectedSessions`/`sessionOffsets` 之上、互不依賴
彼此，可以並行但建議同一階段一起 review（同一組資料模型的第二、三個
消費者）。

**內容**：
1. `TrackMap.vue`：疊圖線的位移改為套用 `sessionOffsets[id].mapX/mapY`
   （目前疊圖線完全沒有位移邏輯，直接複用 `pixelShift()` 的技術）。
2. 疊圖清單/圖例 UI 從地圖卡片挪到全域工具列（§3.4）。
3. `ScatterChart.vue`/`GgChart.vue`：接受 `comparisonSessions`，每個 session
   一個點雲 series（整個 session，§2.2），色＝session 身分色；**確立 §5
   的色盤衝突規則**（多 session 時，色相給 session，不再細分逐圈顏色）。

**風險**：低-中。地圖部分風險最低（既有機制擴充）；XY 部分要處理「目前
`selectedLaps` 存在時的逐圈上色」與「多 session 上色」同時出現時的優先序
（建議：有 ≥1 個 comparison session 時，per-lap 上色規則整個讓位給
per-session 上色，`selectedLaps` 此時只影響 primary 這一個點雲要不要拆成
每圈一個 series——即兩套規則不同時生效，避免笛卡兒積爆炸）。

### Phase 3 — 圈次表 / Sector 輕量跨檔比較

**內容**：`LapTable.vue`/`SectorPanel.vue` 各自新增一個唯讀摘要區塊：每個
`selectedSessions` 成員一行，顯示「該檔最快圈時間」+「與 primary 最快圈的
delta」。**不做逐檔併列成一張大表**（理由見 §9 開放問題）——這是本文件
對「圈次表要不要併列多檔」這個開放問題的**建議答案**，但仍列為開放問題
讓使用者拍板，因為若使用者本來就想要的是「並排比較每一圈」，這個輕量方案
會不夠用，需要在動工前確認。

**風險**：低。純新增的唯讀 UI，不改動任何現有欄位/選取邏輯。

### Phase 4（stretch，需另外拍板是否要做）— 時序圖 overlay 模式的跨檔選圈

**內容**：把 `lapStore` 的圈次身分從 `index`（隱含「目前 active session
的第 N 圈」）升級成 `{fileId, index}`，讓 `selected`/`manualExcluded`/
`offsets`/`columns` 全部變成 session-aware，`buildLapOverlay` 接受跨檔的
`(session, channel, lap)` 組合，`LapTable`/`MapAlignPanel`/`LapAlignPanel`
全部要跟著改。

**為什麼放最後**：這是本文件盤點到的**改動面最大、風險最高**的一塊——
`lapStore` 目前被 `useLaps`/`useCircuitPersistence`/`LapTable`/
`SectorPanel`/`MapAlignPanel`/`LapAlignPanel`/`AnalyzerView` 六七個地方
直接讀寫，圈次身分升級是一次貫穿性的資料模型變更，不像 Phase 1-3 都只是
「新增一個平行的 comparison 資料流，不動既有 primary-only 邏輯」。**建議
先讓 Phase 1-3 上線、觀察使用者實際比較行為**（例如使用者比較常用「整段
時序線疊在一起看趨勢」還是「真的想要逐圈對齊比較」），再決定要不要啟動
這個較深的重構。本文件先記錄設計方向，不列入本輪必做範圍。

---

## 8. 相容性：現有 localStorage schema 如何無痛升級

| 現有 key | 影響 | 升級方式 |
|---|---|---|
| `aracer-loga.analyzerCharts.v1`（`charts[]`：channels/mode/xChannel/yChannel/**equalAspect**） | 若 Phase 1-2 要新增「這張卡片是否參與全域比較」的逐卡片開關（見 §9 開放問題），需要新增欄位 | **零風險**：這個 schema 已經有過一次「新增欄位」的先例——`equalAspect` 就是後補上去的，`parseCharts` 對缺欄位做 `looksLikeForcePair` 回填。新欄位（例如 `showComparison?: boolean`）比照同樣手法：缺欄位時 `parseCharts` 回填預設值（建議預設 `true`——全域套用），不需要 bump 檔頭的 schemaVersion（現有格式本來就沒有 version 欄位，走的是「permissive per-entry parse」風格） |
| `aracer-loga.dashboardLayout.v1` / `panelState.v1` | 若全域比較面板要變成一張新的 static 卡片（而非純工具列 widget），需要新增一個 `STATIC_CARD_IDS` 項目 | **零風險**：這正是 `sessionmerge`/`trackfile` 卡片當初加入時走過的路——`STATIC_CARD_IDS` 加一筆、`DEFAULT_MIN_SIZE`/預設 layout 加一筆位置，既有使用者的 `dashboardLayout.v1` 沒有這個 id 時，既有 reconcile 邏輯（新增項目走預設位置）已經處理過這個情境 |
| `overlayFileIds`（analyzerStore in-memory 欄位） | 語意擴充/更名 | **零風險**：本來就是 transient、不持久化，沒有跨版本相容問題，唯一要注意的是程式碼內所有讀寫這個欄位的地方（`useTrackOverlay.ts`/`TrackMap.vue`/`AnalyzerView.vue`）要一起改名，屬於一次性的程式內重構，非使用者可見的資料相容性問題 |
| `lapStore.offsets` / `sectorStore.gates`（per-circuit，經 idb） | 不受影響 | Phase 1-3 都不改動這兩個既有欄位的 shape；Phase 4 若真的做跨檔選圈，`lapStore.offsets` 的 key 才需要從 `number` 升級成 `{fileId,index}` 的複合 key，屆時才需要另外設計 idb schema 升級（不在本次範圍） |

**整體結論**：本次規劃的 Phase 1-3 完全不需要 schema version bump 或遷移
腳本，全部走既有的「新欄位可選、缺欄位時回填預設值」模式，這也是選擇
Phase 1-3 範圍（而非一次做到 Phase 4）的另一個理由——改動面小，相容性
成本就低。

---

## 9. 開放問題（需使用者拍板）

1. **主（primary）session 的選擇邏輯要不要改變？**
   建議：維持現有 `activeFileId` 下拉選單不變，不新增「指定誰是主 session」
   的額外 UI——使用者已經很熟悉「記錄」下拉選單的角色，只是現在它的角色
   要更明確地定義為「圈次表/sector/齒比/避震/加速測試/熱力圖的唯一依據，
   同時也是時序圖/XY圖/地圖的比較基準」。**是否同意維持現狀，不新增切換
   primary 的獨立概念？**

2. **圈次表要不要真的併列多檔？**
   本文件 Phase 3 建議只做「輕量摘要（最快圈 + delta）」，不做逐檔並排
   大表格。**是否接受這個範圍，還是一開始就要並排表格（會拉高 Phase 3
   的風險與工時，且與 Phase 4 的跨檔選圈高度相關，可能需要提前討論
   Phase 4）？**

3. **時序圖 timeline 模式的視覺編碼：色=session 該搭配什麼線型規則？**
   建議「色=session、同一 session 內的不同 channel 用現有 PALETTE 的第二
   層次（例如 dash pattern）區分」，但也可以是「色=channel（維持現況）、
   session 用線寬/透明度區分」。**兩種哪個比較符合直覺，還是有第三種
   想法？**（此決策會直接影響 Phase 1 的實作細節，建議在 Phase 1 動工前
   先定案。）

4. **offset 預設對齊方式**（§3.3）：採方案 A（各檔自己起跑線通過時刻為
   零點）、方案 B（各檔 log 起點對齊）、還是方案 C（純手動，預設 0）？
   本文件建議方案 A。

5. **比較面板 UI 位置**：是否同意把比較清單/圖例從地圖卡片挪到全域工具列
   （§3.4）？這會改變現有使用者已經熟悉的「地圖卡片裡有疊圖 checkbox」
   的位置，屬於一次可感知的 UI 變動。

6. **色盤衝突規則**（§5）：多 session + 多圈同時出現時，「色=session、
   圈用透明度/線型區分」是否是可接受的取捨？（相對於現狀「色=圈序」的
   使用者，這會改變他們已經熟悉的視覺語言。）

7. **Phase 4（跨檔選圈）要不要排進這一輪的路線圖，還是先觀察 Phase 1-3
   上線後的實際使用回饋再決定？** 本文件建議後者。

8. **`selectedSessions` 是否需要「逐卡片可關閉全域比較」的開關**（例如
   某張時序圖卡片只想單獨看 primary，不想被全域比較污染）？建議提供
   一個預設開啟、可個別關閉的卡片層級開關（比照 `equalAspect` 的持久化
   模式，§8），但這會讓 Phase 1 的 `ChartConfig` 多一個欄位，需要確認
   是否要在 Phase 1 就做，還是先做「全域套用、無法逐卡片關閉」的最簡
   版本。

---

## 10. 附錄：本文件盤點過的關鍵原始檔案位置

- `src/composables/useActiveSession.ts` — 目前唯一的「作用中 session」
  衍生點
- `src/stores/fileStore.ts` — 多檔原始資料容器（早已是多檔的）
- `src/stores/analyzerStore.ts` — `activeFileId`/`overlayFileIds`/
  `charts[]` 等全域狀態
- `src/composables/useTrackOverlay.ts` + `src/domain/analysis/
  trackOverlay.ts` — 現有唯一的多檔疊圖實作（地圖）
- `src/features/analyzer/TrackMap.vue` — 疊圖繪製、`pixelShift`/offset
  技術參考
- `src/stores/lapStore.ts` — `LapOffset` 的 API 形狀參考（§3.2 的藍本）
- `src/domain/analysis/lapOverlay.ts`（`buildLapOverlay`）— overlay 模式
  的圈次重基準/重取樣邏輯，Phase 4 需要擴充的核心
- `src/features/analyzer/TimeSeriesChart.vue` / `ScatterChart.vue` —
  Phase 1/2 主要改動對象
- `src/domain/analysis/colorPalette.ts` + `src/features/analyzer/
  lapColors.ts` — 色盤共用與衝突來源
- `src/domain/layout/chartConfigs.ts` — 圖表卡片持久化格式，§8 相容性
  參考（`equalAspect` 回填先例）
- `src/domain/analysis/downsample.ts` — 已寫好但從未接線的 `lttb()`，
  Phase 1 的效能安全網
- 本機效能量測筆記 — 本文件 §6 引用的完整效能量測基準
- `src/composables/useCircuitPersistence.ts` + `src/domain/persist/
  circuitKey.ts` — 起跑線/gates 的 per-circuit（非 per-file）持久化，
  說明「同賽道切換檔案」的既有優勢

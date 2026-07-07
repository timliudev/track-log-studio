# aRacerLogaAnalysis — 設計文件 / Design Doc

> 本文件記錄專案的需求、技術決策與討論過程，作為實作的依據與日後維護的脈絡。
> This document records requirements, technical decisions, and the discussion log
> that shaped them. It is the source of truth for implementation.

最後更新 / Last updated: 2026-06-18

---

## 1. 專案目標 (What & Why)

一個分析 aRacer ECU `.loga` 記錄檔的工具，兩大功能：

1. **轉檔器**：把 `.loga` 轉成 RaceChrono DIY `.nmea`（NMEA 0183 `$GPRMC` + RaceChrono `$RC3`）供下載。
2. **分析器**：載入 `.loga` 在賽道底圖上顯示軌跡、切圈、繪製各種遙測圖表做賽道分析。

### 核心設計約束（使用者需求）

- **純前端、無後端**：所有資料在使用者裝置本地處理，不上傳。
- **PWA**：可安裝成手機 App（iOS / Android）、可離線。
- **響應式**：自動適應手機 / 平板 / 桌面，亦可手動切換版面與縮放。
- **日夜模式**：跟隨瀏覽器 `prefers-color-scheme`，亦可手動。
- **觸控 / 滑鼠 / 觸控板**：統一以 Pointer Events 處理，設定可調。
- **設定永久化 + 匯出**：所有設定本地保存，可匯出 JSON 方便轉移。
- **多語系**：繁體中文 / 英文，自動偵測 `navigator.language`，可手動。
- **部署**：build 成靜態檔 → GitHub → **Cloudflare Workers（靜態資產）**，由 **Workers Builds**（接 GitHub）自動建置部署（純靜態，無自寫後端邏輯）。
- **未來預留 Google Ads**（非目前必要）。

---

## 2. 技術選型 (Tech Stack) 與理由

| 角色 | 選擇 | 理由 |
|---|---|---|
| 語言 | **TypeScript** | 型別即 contract，對重視架構者是護欄；對前端新手是安全網 |
| 框架 | **Vue 3.5+（Composition API + `<script setup>`）** | 學習曲線平緩、響應式與 i18n 生態成熟 |
| 建置 | **Vite** | 快、HMR、PWA 一個 plugin 搞定 |
| 狀態 | **Pinia** | Vue 官方狀態管理，setup 風格、TS 友善 |
| PWA | **vite-plugin-pwa (Workbox)** | 自動產生 service worker / manifest / 離線快取 |
| 時序圖表 | **uPlot** | 為遙測而生，百萬點仍流暢、極輕量、X 軸同步容易 |
| 散點 / 分布 / G-G 圖 | **ECharts**（或 Observable Plot） | 散點、熱區、分布圖強 |
| 軌跡 / 底圖 | 自繪 **Canvas** | 疊底圖、調位置、畫起終點線，自繪最可控 |
| 線上地圖（選用） | **OpenStreetMap**（免費）/ 衛星圖（使用者自帶 API key） | 見 §6.3 |
| FFT | 純 JS FFT 函式庫（如 fft.js） | 避震行程、輪速等轉頻域 |
| i18n | **vue-i18n** | 繁中 / 英、自動 + 手動 |
| 本地儲存 | **localStorage**（小設定）+ **IndexedDB / idb**（大資料） | 見 §7 |

### 為什麼純前端可行（即使檔案 54MB）

Super2.loga 範例達 **54MB**。可行，但需正確處理：

- **Web Worker** 背景解析，避免 UI 凍結。
- 解析結果存成**逐欄 `Float32Array`（column-store）**，不存物件陣列（會爆記憶體）。
- 圖表顯示**降採樣**（如 LTTB），分析計算用**全解析度**。

### 為什麼先不用 WASM

JS/TS + Worker + TypedArray 解析 54MB 綽綽有餘。WASM 留作日後 profiling 發現瓶頸時的優化選項；計算模組會放在可替換的邊界後，未來抽換不影響其他層。

### OOP vs FP 風格

- **邏輯用純函數（FP）**：解析、避震換算、FFT、切圈 — 無副作用、好測。
- **狀態用響應式 store（Pinia）** + **composables（`useXxx()`）** 黏合。
- **僅少數有「身分」的資料模型**用 class / interface（如 `LogSession`）。
- 結論：務實 FP 為主，不教條。

---

## 3. 架構 (Architecture)

主流 Vue feature-based 結構，但把**核心邏輯抽成不依賴 Vue 的純 TS 層**（這本身就是現代 Vue 最佳實踐，方便單元測試）。

```
src/
├─ domain/          ← 純 TS，零 Vue。可單獨在 Node 跑測試
│   ├─ parsing/         三種檔頭 parser + 偵測器註冊表
│   │   ├─ formats/         Super2Format / SuperXFormat / RaceAmpFormat
│   │   ├─ HeaderDetector.ts
│   │   └─ LogaParser.ts
│   ├─ model/           LogSession / Channel / Lap
│   ├─ export/          Exporter 介面 + Rc3NmeaExporter（移植自 loga2nmea.py）
│   ├─ analysis/        lapDetection / fft / distance
│   └─ units/           避震 AD→mm、G 值換算
├─ stores/          ← Pinia：sessionStore（載入的資料）、settingsStore
├─ composables/     ← useLogSession / useChartSync / usePointerDraw ...
├─ features/
│   ├─ converter/       Phase 1：轉檔器 UI（含槽位對應面板）
│   └─ analysis/        Phase 2：分析 UI（軌跡 / 圖表 / 表格）
├─ components/      ← 共用 UI（搜尋下拉、按鈕、面板…）
├─ workers/         ← parse.worker.ts（背景解析）
├─ i18n/  theme/  pwa/
└─ App.vue  main.ts
```

### 可替換性（對應需求）

- **換輸出格式**（#1.8）→ 新增一個 `Exporter` 實作，其餘不動。
- **換 / 加輸入檔頭**（#8、#2）→ 新增一個 `formats/XxxFormat.ts` 註冊進偵測器。
- **換 UI 框架** → 只有 `features/` `components/` 受影響，`domain/` 完全不動。

---

## 4. `.loga` 格式分析（實測四種檔頭）

四種檔頭並存，**parser 必須是「格式偵測器註冊表」**：

| 檔案 | 第一行標記 | 檔頭結構 | 取樣率 | 避震資料 | GPS 編碼 |
|---|---|---|---|---|---|
| Super2.loga | `<Cycling Memory Log Data of Super ECU>` | 固定行：第5行群組、第6行欄名、第7行起資料 | 62.5ms (16Hz) | ❌ | 整數度/分 |
| SuperX.loga | `<aRacerX Memory Log File>` | 標記式：`<VAR NAME>` 下一行欄名、`<DATA START>` 下一行起資料 | 62.5ms (16Hz) | ❌ | 整數度/分 |
| logger2.loga | `<aRacer ECU_Memory Log Data for RaceAMP>` | `Product ID = ...; Table ID...` 單行 + 群組行 + 欄名行 + 資料 | 31.25ms (32Hz) | ✅ | 整數度/分 |
| (MX APP) | `<aRacer MX APP Log File>` | 與 SuperX 同標記式 layout（多 `<VAR ID>` / `<VAR GROUP>` 兩段，掃描略過） | 100ms (10Hz) | ❌ | 十進位（手機 `Phone_GPS_*`） |

共通慣例：
- 欄名格式為 `Canonical/中文說明`，以 `/` 切開取前段作正規名（MX APP 欄名無 `/說明` 後綴）。
- 資料區為純 CSV。
- 既有別名：`AFR`↔`AFR_WBO2`、`Volt_Batt`↔`Volt_Batt_indx`；新增 `GPS_Lat`↔`Phone_GPS_Latitude`、`GPS_Lon`↔`Phone_GPS_Longitude`（把 MX APP 的手機十進位座標當成 session 的 `GPS_Lat/GPS_Lon`）。

> **重點**：原 `loga2nmea.py` 只處理 Super2 / SuperX 兩種；**RaceAMP（logger2）** 為唯一含避震 `SuspensionAD1/AD2`、`Front/Rear Suspension`、`EXIN_AD1~3` 的格式，新專案已補。**MX APP** 由 aRacer x Tune Android App 分享輸出（常以 `.zip` 包一個 `.loga`），layout 與 SuperX 共用同一 marker 掃描，差別在標題、`2026-05-15 17:53:50` 破折號日期、與「GPS 只有手機十進位座標」。
>
> **GPS fix 單一來源**：因 MX APP 走十進位、ECU 格式走整數度/分，把兩種編碼的「逐列 fix 解析」收斂到 `domain/gps/gpsFix.ts` 的 `makeFixResolver`，由分析器軌跡（`extractGpsTrack`）與 `.nmea` 匯出器**共用**，整數路徑數學不變（golden 逐位元相符）。
>
> **`.zip` 上傳資安**：`.zip` 為不可信輸入，`domain/import/zip.ts` 以副檔名白名單（只解 `.loga/.nmea`）、解壓前 `originalSize` 累計上限（擋解壓炸彈）、entry 路徑只取 base name（擋 zip-slip）三道防線處理。

---

## 5. 功能一：轉檔器 (Converter)

### RC3 欄位對應

- **固定填入（不可選）**：`xacc / yacc / zacc`（由 `TC_Xforce/Yforce/Zforce ÷ 1000`）、`gyrox/y/z`、`rpm/d1`（RPM）。GPS 由 `$GPRMC` 提供，含平滑化航向（沿用 py 的 heading 平滑演算法）。
- **可選填入**：`d2, a1–a15`，由使用者把 loga 欄位指派到這些槽位。
- **預設組合**：`TPS_percent[d2]、t_eng[a1]、t_air[a2]、SA[a3]、Volt_Batt[a4]、AFR_WBO2[a5]、ISC_Air_Flow[a6]、MGU_A[a7]、P_atm[a8]、TC_Lean_Angle[a9]…`
- **Preset**：預設 / 使用者 1~5 / 重設，自動保存。

### 欄位選擇 UX（**決議：槽位導向 + 可搜尋下拉**）

RC3 槽位固定有限（16 個），loga 欄位數百個，故以「**幫每個槽位指定一個 loga 欄位**」為心智模型：

- **桌面版**：表格，左欄 RC3 槽位（a1…a15），右欄每列一個下拉；**下拉最上方固定搜尋框**即時過濾數百欄。
- **手機版**：點槽位 → 全螢幕挑選頁，底部固定搜尋欄，上方可捲動 list。

### 輸出

- 檔名維持原 `.loga` 名（改副檔名 `.nmea`）。
- 轉換完成自動下載，並提供「下載」按鈕再次取得。
- 批次轉檔逐檔產生。
- 轉換邏輯移植自 `loga2nmea.py`（heading 平滑、GPRMC 組裝、NMEA checksum）。

---

## 6. 功能二：分析器 (Analyzer)

### 6.1 軌跡與底圖
- 可上傳自訂底圖，手動拖放 / 縮放對齊軌跡。
- 軌跡圖**持續顯示**於畫面（所有視圖都看得到目前位置）。

### 6.2 切圈 / 起終點線（**決議：線段**）
- 以**一條線段（兩個可拖曳端點）**定義起終點，軌跡穿越即計圈。
- 觸控：點兩下放端點 + 拖曳把手（命中區 ≥44px）；滑鼠：按下拖曳成線。共用同一資料。
- **圈時來源兩選**：(a) 我們畫的線段自算；(b) ECU 內建 `IR_LapNumber` / `IR_LapTime`。
- 可單圈 / 全軌跡 / 多圈疊圖顯示。

### 6.3 底圖對位（**決議：兩種都開放**）
- **免費**：使用者上傳底圖（手動對位）＋ OpenStreetMap 街道圖磚（免金鑰）。
- **衛星圖（付費）**：使用者**自帶 API key**（Mapbox / Google 等），key 存本地、不外流；未填則僅免費選項。

### 6.4 圖表
- X 軸：時間或距離（距離由 GPS haversine 累積）。
- Y 軸：自由選擇，可多軸疊圖或獨立顯示。
- 多圖表 **X 軸同步**；軌跡圖同步顯示目前游標位置。
- XY 軸可縮放。
- **G-G 圖**：橫向/縱向 G 圓形點雲。
- **FFT**：避震行程、輪速等轉頻域（找共振 / 路面頻率）。
- **分布圖**：XY 自選。
- **每圈統計表**：圈時、距離、車速…可選欄位。

### 6.5 避震校正（**更正：5 參數，對齊原廠 App**）

每通道（前 / 後）參數，單位 mv / mm：
- **最小電壓 min_mv、最大電壓 max_mv、零點電壓 zero_mv**（mv）
- **最小行程 min_mm、最大行程 max_mm**（mm）
- 來源 AD：`SuspensionAD1` / `AD2`（可對調，因安裝可能插反）。
- 線性換算：`pos(ad) = min_mm + (ad − min_mv) / (max_mv − min_mv) × (max_mm − min_mm)`
- 零點：輸出 = `pos(ad) − pos(zero_mv)`（行程相對零點；零點語意實作時再與使用者確認）。
- 僅在偵測到 SuspensionAD 欄位（目前只有 RaceAMP 格式）時出現。

**架構（共用於轉檔器與分析器，而非獨立工具）：**
- 純函數 `domain/units/suspension.ts`：`adToTravel(ad, params)`，可單元測試。
- **「衍生通道（derived channel）」機制**：解析後依設定算出 `Front/Rear Suspension(mm)`
  通道，**附加到 LogSession 的可用通道清單**。如此：
  - 轉檔器：衍生通道出現在槽位對應的可搜尋選單，可塞進 RC3 類比槽。
  - 分析器：衍生通道可直接拿來繪圖 / FFT。
- 共用設定 store（前 / 後各一組參數）持久化；校正面板為共用元件，轉檔器與分析器皆可開啟。
- **不改寫回原始 `.loga`**（保資料完整、可重現）；「寫回」的需求改以衍生通道 + 匯出達成
  （同樣的 mm 值能進 NMEA 也能進分析，效果一致而不破壞來源檔）。
- 排程：**Phase 2（分析器之前）**，見 §11。

---

## 7. 設定持久化與匯出 (#9)

- 小設定（主題 / 語言 / 單位 / 欄位 preset 中繼資料）→ **localStorage**。
- 大資料（上傳的底圖、完整 preset 集合）→ **IndexedDB**（localStorage 約 5MB 上限會爆）。
- 全部包在 `SettingsRepository` 介面後，UI 不需知道存哪。
- **匯出 / 匯入**：序列化成單一 JSON 檔下載 / 上傳還原。

---

## 8. 跨平台與輸入相容 (#3, #4, #5, #7)

- **檔案選擇**：底線 `<input type="file" multiple>`（全平台含 iOS、天生批次多選）；特性偵測支援者再加碼 File System Access API（桌面 Chrome/Edge 記住資料夾）。**iOS Safari 不支援新 API，故不降級核心功能。**
- **響應式**：CSS 變數 + container queries；可手動切換版面與縮放，並持久化。
- **日夜**：`prefers-color-scheme` + 手動覆蓋，CSS 變數主題。
- **輸入**：Pointer Events 統一滑鼠 / 觸控 / 觸控板；可在設定調整。

---

## 9. 效能策略 (#5)

- Worker 解析 + 進度回報（進度條）。
- Float32 column-store。
- 顯示降採樣（LTTB），分析用全解析度。
- 取捨：多花工程力（Worker 複雜度、降採樣）換不凍結 UI 與流暢縮放；對使用者無壞處。目標 54MB 數秒內完成。

---

## 10. 部署 (#6)

- `npm run build` → 靜態 `dist/` → push GitHub → **Cloudflare Workers（靜態資產 / Workers Builds）** 托管。
- 純靜態 SPA/PWA，**無自寫後端邏輯**；Cloudflare Workers 僅作靜態資產托管（SPA fallback），非執行應用程式碼。
- Node.js 僅開發期跑 Vite，上線後無伺服器執行。

---

## 11. 開發階段與 Commit 規劃 (#12)

- **Phase 0 — 骨架**（✅ 完成）：Vite + Vue + TS + Pinia + PWA + i18n + 主題；`domain/` 三種 parser + 偵測器 + 單元測試（拿既有 `.nmea` 當黃金樣本）。
- **Phase 1 — 轉檔器**（✅ 完成）：RC3 槽位對應面板（可搜尋下拉）+ preset + 批次轉檔 + 下載；後續補上 GGA/RMC、logger2 合成時間戳、說明與頁尾。
- **Phase 2 — 避震校正（衍生通道）**（✅ 完成）：`domain/units/suspension.ts`（5 參數換算 +
  倒算）+ 衍生通道機制 + 共用校正面板與設定 store。先於分析器，讓轉檔器即可把避震 mm 塞進
  RC3。後續：衍生通道沿用 `Front/Rear Suspension` 欄名並覆蓋；accel/gyro 缺欄輸出留空；
  設定分頁移到最右。
- **Phase 3 — 另存校正後 `.loga`**：loga 寫出器（保留原檔、只換避震欄位另存新檔）。
- **Phase 4 — 分析器**（分子階段）：
  - **4a（✅ 完成）**：軌跡圖(canvas) + 時間/距離序列圖(uPlot) + 游標連動；
    `domain/analysis`(gpsTrack/distance/lttb/timeAxis)。NMEA 輸入讀取器(`domain/import/nmea`)亦已備妥。
  - **4b（✅ 完成）**：分析器「＋新增圖表」儀表板;序列圖**每通道獨立 Y 軸**(解決壓平)、
    多圖表、**X 軸縮放同步**(`analyzerStore.xRange`);#6 dpr/resize 重繪修復。
  - **4c（✅ 完成）**：共用頂部 `FileBar`（.loga + .nmea）+ `fileStore` 抽離 `converterStore`;
    分析器可直接吃 `.loga` / `.nmea`;`gpsTrack` 增加 decimal-degree fallback;
    `LogaFormatId` 加入 `'nmea'`;`nmeaToSession` 函式;64 tests 通過。
    跨圖表游標同步亦於本輪完成（UPlotChart `externalCursor` prop + `valToPos` 同步;
    guard 防回響）。
  - **4d — 圈次（核心完成，持續擴充）**：
    - **4d-1/2/3（✅）**：圈次偵測 domain 層(`domain/analysis/laps.ts` — 線段穿越:
      平面投影 + straddle 測試 + 方向自動判定 + minLapMs debounce;`detectLapsByChannel`
      用 ECU `IR_LapNumber`);軌跡圖可拖曳起終點線(geo 端點存 `lapStore`,
      `projection.ts` 抽出共用 geo↔pixel,≥44px 觸控把手,拖曳抑制 chart cursor);
      `useLaps` 自動播種預設線;每圈統計表 `LapTable`;圈時來源切換(線段自算 / ECU);
      選圈 → `setXRange` 聚焦 + 軌跡高亮。
    - **修正包 A（✅）**：最高速改讀真實速度通道(`GPS_Speed`/`Vehicle_Speed`,非 GPS
      位置差現算);起終點線提示 + 把手強化;**重設線改為重新播種**(修復線消失無法再加);
      取消選圈鈕;**選圈↔縮放補同步**(拆掉互打 watcher,改命令式 handler:選入→放大、
      明確選出→縮回、手動縮放→取消選取但保留視圖)。
    - **批次 B 可設定欄位（✅）**：統計表欄位可增減,每欄 = 通道 + 聚合(max/min/avg)。
    - **批次 C1 多選上色（✅）**：表格多選圈、軌跡**只顯示被選的圈並依圈上色**
      (`lapColors.ts` 8 色 + `highlightLaps`)。
    - **批次 R 架構整理（✅）**：`domain/analysis/lapMetrics.ts` 的 `LapMetric` 區別聯集
      + `computeMetric` **統一所有「每圈數值」來源**——原始通道聚合與圈結構/跨圈指標收在
      同一介面後,未來 delta/sector/optimal lap 只需加一個 union variant + case +
      `LapContext` 欄位;cursor 由元件 local ref 移入 `analyzerStore`(共享)。
    - **C2（待做）**：被選圈疊在 XY 折線圖比較、**切圈後 X 軸從 0 起算**(圈相對距離對齊)。
    - **C3 跨 log（延後,與 Phase 5 合併規劃）**：跨不同已載入 log 選圈比較(需分析器持多 session)。
  - **4e — 其他圖表與互動**：G-G 點雲、分布圖、FFT（加 ECharts）；
    **可拖動重排的圖表儀表板**(寬螢幕多欄,善用兩側);
    #7 框選縮放時軌跡聚焦該段；**圖表觸控手勢**(雙指/拖曳/雙擊;uPlot 縮放僅支援滑鼠);
    **軌跡圖縮放/平移**(類 Google 地圖:滾輪 + 雙指 + 拖曳;目前軌跡圖在觸控下無互動,屬待做)。
- **Phase 5 — 合併（RaceChrono GPS + loga）**：（NMEA 讀取器已於 4b 具備）當 loga 無 GPS /
  GPS 異常時，匯入 RaceChrono
  `.nmea`（`.rcz` 之後）取得好 GPS 軌跡，與 loga 引擎數據**手動時間對齊**（速度疊圖 +
  互相關建議），重新取樣後**匯出合併 .nmea**。新增 NMEA **輸入**解析器（補齊模組化輸入），
  對齊 UI 重用 Phase 4 圖表。難點：時鐘漂移（先單一位移）、取樣率內插。
- **Phase 6 — 上線準備（改為漸進上線，邊開發邊部署）**：
  - **6a 對外品牌 + 上線前置（✅ 完成）**：產品改名 **Track Log Studio**（網頁標題 /
    PWA manifest / i18n / package 名 / repo 名）；aRacer・RaceChrono 僅保留為相容性描述；
    footer **build 戳記 = commit hash + 日期**（CI/CD 自動帶入,無 release tag 以 commit
    hash 當版本）；`LICENSE`(MIT)；README 雙語商標免責；`THIRD-PARTY-NOTICES.md`；
    `.nvmrc`=22。**已 push 並公開**：`github.com/timliudev/track-log-studio`。
  - **6b 完整收尾（待做）**：內部資料夾 / 程式碼大改名、`docs/DESIGN.md` 標題改名、
    關於我頁、SEO（meta/OG、robots.txt、sitemap、structured data）、Logo / favicon
    （PWA icon 換點陣 PNG 192/512 + maskable）、使用說明外部文件連結。
- **Phase 7 — 直線加速測試（idea，不急，先記錄）**：在整段軌跡中**掃描出符合條件的最速區段**並列出，
  常見於速可達/機車玩家。設計為一個**可調項目**（搜尋整條 log）：
  - **距離型**：例如「0~400m 最速」——找出跑完 400m 花時間最短的區段。但若要求「從靜止 0 起跑」會限制太死，
    故傾向**複合條件**：從車速 `v0`（可為 0）起、再跑 `d` 公尺的最短秒數。
  - **車速型**：例如「0~100 km/h」最短秒數 / 距離（標準加速指標）。
  - **歸屬**：本質上和分析器的「圈/區段」是同一類東西——一段被選出的軌跡片段配一個衍生數值，
    因此**併入 lap/segment 架構**：視為 `LapMetric` 的新 variant + `computeMetric` 的新 case（見 §11 Phase 4 E、
    架構鐵則），不另起爐灶。掃描演算法（滑動視窗找最佳區段）為唯一新增的計算。
- **`.vbo` 輸出格式（Phase 1 轉檔器延伸；✅ 已實作 2026-06-23）**：轉檔除了 `.nmea`，再加
  **Racelogic VBOX `.vbo`**，讓 log 直接在 **Circuit Tools 3**（Racelogic 官方、免費、賽道分析等級）
  與 **RaceChrono** 開啟。**相對 RC3 `.nmea` 的關鍵價值**：NMEA 只有 15 個固定類比槽（要槽位對應、
  多數欄位塞不下），VBO 把**所有通道**當具名 custom channel + 單位全帶過去 → 每個 ECU 通道都到得了分析軟體。
  - **輸出（每個 .loga 產 3 檔）**：`_ct.vbo`（Circuit Tools，[header] 用原始 ECU 名）、
    `_rc.vbo`（RaceChrono，`rc_` 官方識別符 + 內嵌 channel map）、`_channels.csv`（頻道對照表，
    含中文說明，UTF-8 BOM）。轉檔器 UI 加「輸出格式 NMEA / VBO」分段選擇器；選 VBO 時隱藏 RC3
    槽位對應面板（VBO 自動輸出全通道，免對應）。
  - **實作**：`domain/export/vbo/`（`VboExporter.ts`＝`convertToVbo()`；`semantic.ts`＝語意對照表 +
    通用桶 `Allocator`（rc_<base>_1..63 溢出）；`format.ts`＝printf 風格數值）。重用 `makeFixResolver`
    （GPS 整數度分 + mxApp 十進位雙編碼）、`computeSmoothedCourses`（航向），衍生避震 mm 比照 RC3 餵入，
    **直接 iterate session 通道、不寫死索引**（四格式自動支援）。未知通道自動歸入通用 `analog`/`digital` 桶。
  - **VBO 格式**：`[header]`（顯示名一行一個）/`[channel units]`/`[comments]`/`[column names]`
    （短 id 空白分隔）/`[data]`；7 標準欄 = sats、time（`HHMMSS.sss` UTC 當日）、lat/lon
    （**以「分」表示**，**VBO 慣例經度正值=西**、緯度正=北，**≠ NMEA 易錯**）、velocity km/h、heading、height(0)。
  - **時間欄來源優先序**：① `GPS_UTC_hh/mm/ss/ms` 有效（非全 0）→ 直接用真 UTC；② 否則
    Created Date 當日時分秒為基準 + `Time` 欄經過時間；③ 無 Time 欄 → 基準 + 取樣率合成；
    ④ 連 Created Date 都無 → 00:00:00 起算。GPS_UTC 四欄已納入 `GPS_CONSUMED`（折進 time 欄，不重複輸出成 analog）。
  - **Circuit Tools 卡死修正**：註解內絕不能出現 `[ ]`（字面 `[header]` 會被當區段標記，解析器在註解
    中途重入區段解析而卡死）→ `_ct` 改用與 `_rc` 相同的 bracket-free channel map，且所有註解一律把
    `[ ]` 換成 `( )`（`safeComment`）。
  - **參考腳本**：`C:\Data\repo\LOGAtest2\loga2vbo.py`（取代舊 LOGAtest1 版；`_ct`/`_rc`/`_channels`
    三輸出 + bracket 修正）。**初版三檔全做**（不再 full-only；RaceChrono 雖與 RC3 nmea 重疊仍一併輸出）。
  - **回歸測試**：用**截斷版 golden**（header + 前 40 列，避免 ~23MB 全檔進 repo）以 Python 輸出對齊
    （`_ct`/`_rc` 容差比對、CSV byte-for-byte）+ GPS_UTC 來源 / 無括號註解 / 經度反向慣例守門
    （`test/export/vbo.test.ts`、fixtures `vbo.*`）。
- 每階段內再細分小 commit。
- **設計原則**：功能能力以**實際欄位**（`session.has(...)`）判斷，不以檔頭/格式硬編；
  檔頭僅決定如何解析結構。
- **商標**：`aRacer`（ECU 廠商）與 `RaceChrono` 皆為註冊商標，不得當品牌名，僅作相容性描述。

---

## 11b. 目前狀態與待辦（接續用，2026-06-18）

### 部署 / 流程現況
- **已公開上線中**：`github.com/timliudev/track-log-studio`（public）。`main`=正式、
  `develop`=Cloudflare preview。**gitflow 照舊**（feature→develop→`--no-ff`→main），
  「先別 push」規矩**已解除**，之後正常推送。
- **版本策略**：無 release tag，**以 commit hash 當版本**；footer build 戳記由
  `vite.config.ts` 的 `__BUILD_SHA__` 注入（CF_PAGES_COMMIT_SHA→GITHUB_SHA→`git rev-parse`），
  CI/CD 每次部署自動更新。里程碑才鬆散打 tag。
- **Cloudflare Workers（靜態資產）** 由使用者在後台接 Git（**Workers Builds**，prod=`main`、
  build `npm run build`、輸出 `dist`、Node 由 `.nvmrc`=22）；設定見 `wrangler.jsonc`，無需 repo 密鑰。
  正式網址 `https://track-log-studio.timliudev.workers.dev`。（非 Pages——Pages 後台只有另一個專案。）
- **分析 / 廣告**（未來）：GA4 / Cloudflare Web Analytics / AdSense 用**公開 ID**(`VITE_*` env)，
  非密鑰；lazy-load、離線不載、守隱私。

### 近期增量
- **MX APP 格式 + `.zip` 上傳（feature/mx-app-loga-format）**：新增 `mxApp` 解析器（與
  SuperX 共用抽出的 `formats/markerHeader.ts`）、破折號日期、`Phone_GPS_*`→`GPS_Lat/Lon`
  別名；GPS fix 邏輯收斂到 `domain/gps/gpsFix.ts`（軌跡 + 匯出器共用）；`domain/import/zip.ts`
  安全解壓（白名單 / 防炸彈 / 防 zip-slip）；FileBar 接受 `.loga/.nmea/.zip`。詳見 §4。
- **軸顯示 #5/#6（feature/axis-display）**：圖表 X 軸刻度改為可讀格式——時間 `m:ss`／
  `h:mm:ss`、距離自動 m↔km（純函式 `domain/analysis/axisFormat.ts`：`formatElapsed`/
  `formatDistance`/`formatClock`）。時間 + timeline 模式且能取得絕對起點時，**疊加第二條
  X 軸**(uPlot side 2，自動堆疊)顯示當地時鐘 `HH:mm:ss`，軸標籤標 `UTC±N`。起點時刻由
  純函式 `domain/analysis/startTime.ts` `sessionStartAnchor` 決定：**GPS_UTC 優先**（首個
  有效 UTC fix，日期取 header createdDate，再扣掉該 sample 的 elapsed 對齊 elapsed=0，
  source=`gpsUtc`），退回 `meta.createdDate`（把本地時分秒「重新解讀成 UTC」，offset 0 即
  還原 header 印的時刻，source=`created`），皆無→`null`。時區：`settingsStore.tzOverride`
  (`'auto' | 分鐘`，持久化)；auto 時 `gpsUtc` 用瀏覽器偏移、`created` 用 0；Settings 下拉可
  手動覆寫 UTC-12..+14。瀏覽器偏移只在顯示用 computed 讀取、不存成狀態（守批次 R 鐵則）。
  `.wrangler/` 加入 `.gitignore`。

### 依賴 / 資安 / CI（鐵則）
- **每次改動都要評估資安**（尤其處理不可信輸入：檔案、zip、未來的網路請求）。
- **依賴常保最新**：以 `npm outdated` / `npm audit`（聯網查 registry）確認；目前 0 漏洞。
- **CI 已加 `npm audit --audit-level=high`**（high/critical 直接擋）；**Dependabot**（`.github/
  dependabot.yml`）每週對 develop 開 npm + github-actions 更新 PR，過 CI 才進 main。

### 架構原則（批次 R 後的鐵則）
- 原始 `LogSession` **不可變**；每個顯示的每圈數值都是 `computeMetric` 的**純衍生**，不寫回來源。
- 每份狀態**單一擁有者**(store ref)，其餘用 `computed` 衍生；**禁止用 watcher 去寫另一份狀態**
  (那是 #9 desync 的根因)；選圈↔縮放等副作用放在**命令式 handler**。
- 能力以 `session.has(...)` 實際欄位判斷,不以檔頭硬編。

### 待辦佇列（來自 2026-06-18 實機回饋,依建議順序）
1. **#3 起終點線樣式**：與軌跡/cursor 視覺區隔（那顆把手球易被誤認為軌跡位置）。**待視覺驗收**。
2. **#1 Lap 管理（基礎優先）**：新增/排除「切西瓜」的爛圈，避免污染 opt time/delta；
   **標記最速 / 最慢圈**：lap 表內以視覺標記點出最速與最慢圈，排除（excluded）的爛圈不列入計算。
   純衍生於「included laps」集合——最速已有 `domain/analysis/bestLap.ts` 的 `fastestLapIndex`
   做為原始基元，最慢比照新增 `slowestLapIndex`（同一 exclusion-aware 慣例）。
3. **C2 圖表疊圈**（#4,#7）：XY 折線疊被選圈、X 軸圈相對從 0 起算（距離對齊）。
4. ~~**軸顯示**（#5,#6）：X 軸原始值旁加換算（分/公里）；時間加當地時分秒 + 時區設定（log 多為 UTC）。~~
   **DONE**（feature/axis-display，見上方近期增量）。**待視覺驗收**：時鐘第二軸的對位與時區切換。
5. **軌跡熱力上色**（#10,#11）：軌跡依通道值（RPM/G）漸層上色看進彎變化；可選 colormap。
6. **#9 單圈 GNSS 偏移微調**：疊圈對位用的每圈時間/空間位移。
7. **4e 版面**（#12,#13,#8）：laps 暫移到軌跡上方；桌面儀表板布局（左上軌跡、左下游標數值列、
   中 XY、右上 G-G、右中避震/FFT、右下 laps）、手機分頁；非線性轉場動畫（最後做）。
8. **D 本機持久化**：起終點線/sector/欄位設定存 localStorage/IndexedDB，以地理位置為 key 的賽道設定；
   JSON 匯出入。**雲端同步延後**（牴觸純前端,Phase 6+ 選用）。
9. ~~**E 圈次分析**：手動 sector → 理論最佳圈(optimal) → delta time。~~ **DONE**：
   `sectorTiming.ts` 的 `computeSectorTimes`（逐圈 sector 時間）+ `computeOptimalLap`
   （逐 sector 取最小值組出理論最佳圈）；`gateOrder.ts` 的 `sortGatesByPosition` 讓手動加/拖曳的
   gate 依實際圈上位置排序。
10. **F 行動裝置驗收**：真機 + production build 查 Android 載入後偶發重整（疑記憶體壓力,桌面無法重現）。
    **診斷工具已備（`src/debug/diagnostics.ts`，feature/mobile-diagnostics）**：手機無 DevTools、
    重整又清 console，故 `?debug=1` 開啟一個純 DOM 自我診斷面板，把 `document.wasDiscarded`
    （true=系統記憶體壓力丟棄分頁自動重載，非 JS 崩潰）、navigation type、window error/rejection
    （含 stack）、pagehide/freeze/visibility 生命週期、JS heap 記憶體（現值/峰值）寫進 localStorage、
    **重整後顯示在畫面角落**。用法：手機開 `?debug=1` → 載檔重現 → 看面板最後幾筆判斷死因。

> **格式對稱補強**：**VBO 已可匯入**（feature/vbo-import，`parseVbo` + `VboImporter`），
> 與既有 VBO 匯出形成對稱，**分析器可直接開啟 `.vbo`**。匯入 / 匯出 / `LogSession` 的整體
> 格式轉換架構與擴充計畫見 [`ARCHITECTURE-FORMATS.md`](./ARCHITECTURE-FORMATS.md)；
> 二進位 / ZIP 格式（XRK / RCZ / Qstarz）研究見 [`FORMAT-SUPPORT-RESEARCH.md`](./specs/FORMAT-SUPPORT-RESEARCH.md)。

### 新增點子（2026-06-23 實機回饋，待細化）
- ~~**快速篩選無用圈（時間帶過濾）**：設一個有效圈速區間，超出者自動標記無用圈剔除。
  例：ARK 完整圈 46~53s → 區間外自動排除。歸入 #1 Lap 管理 / `LapMetric` 有效性旗標 + UI 區間輸入。~~
  **DONE**（feature/lap-timeband-filter）：`lapValidity` 計算有效性 + `lapStore` 以**聯集**排除
  （手動排除 ∪ 時間帶區間外），UI 提供有效圈速**區間輸入**。
- ~~**Sector 完整性判定有效圈**：每個彎/sector 都有經過才算有效圈（例：ARK 12 彎 → 12 sector 全通過），
  濾掉「切西瓜到空地等待」的假圈。~~ **DONE**：`domain/analysis/sectorValidity.ts` 的
  `invalidSectorLapIndices` 用逐 sector 通過閘門的幾何判定（依序走訪 gate、缺一或跳序即判無效），
  與 `sectorTiming.ts`／`gateOrder.ts` 共用同一套 gate-crossing 幾何（`laps.ts` 的
  `planarGate`/`walkLapGates`）。`lapStore.sectorInvalid` 消費其結果，UI 見 `SectorPanel.vue`。
- **Track 獨立匯入檔 + 雲端同步（分流儲存）**：track 可獨立匯入、**自動推導 sector 與起終點線**
  （目前為手動，見 §6.2 / #8 D）；並雲端同步。**儲存分流**：普世性賽道 → **GitHub** 共享庫；
  個人設定 / 個人圈速紀錄 → 綁**個人 Google Drive**。把 #8 D「雲端同步延後」往前推並具體化。
  **完整設計文件（A2 自動套用 + A3 公開賽道庫）見
  [`CLOUD-TRACK-DESIGN.md`](./CLOUD-TRACK-DESIGN.md)（2026-07-03，設計中，尚未實作）。**

### 已知驗證限制
- 無頭預覽（preview 工具）下 track `<canvas>` 寬度為 0、`preview_screenshot` 逾時 →
  **canvas 視覺無法自動驗證**,只能驗 load/console/DOM 文字,像素由使用者目視。
- 可灌小型合成 `.nmea` 進 file input 測載入路徑（50MB 真檔會觸發重整）。

---

## 11c. 待辦與已完成總表（彙整自 `docs/journal/*`，2026-07-08）

> 實作日誌已歸檔至 [`docs/journal/`](./journal/)、格式規格研究至 [`docs/specs/`](./specs/)。
> 本節是跨日誌的**單一彙整入口**：目前待辦一覽 + 已完成大項各一行（細節指向對應日誌）。
> 進行中的日誌 [`EVENING-WORK-2026-07-07.md`](./EVENING-WORK-2026-07-07.md) 仍在 docs/ 根目錄
> （主 session 還在寫，收工後再歸檔進 journal/）。

### 目前待辦

**2026-07-07 的 22 項回饋 triage**（完整表與拍板紀錄見
[`EVENING-WORK-2026-07-07.md`](./EVENING-WORK-2026-07-07.md)）尚未完成的項目：

| # | 項目 | 狀態 |
|---|------|------|
| 1+21 | 鎖定兩功能分離（📌 每卡 sticky + 🔒 工具列布局鎖） | 🔄 `feature/dashboard-lock-and-mobile`，未合併 |
| 3 | 手機不能調 grid 大小 | 🔄 同上分支 |
| 6 | grid 預設填滿頁面 | 🔄 同上分支 |
| 2 | 地圖疊多檔案軌跡 | 🔄 `feature/trackmap-multi-overlay`（W2） |
| 4 | XY 散佈圖 1:1 等比（可調） | 🔄 `feature/xy-aspect-and-tire-live`（W2） |
| 10 | 輪胎規格即時換算自動套用 | 🔄 同上分支（W2） |
| 5 | 拖動 grid 縫隙調整整頁布局 | ⏳ 依賴 #1+21 的分支先合併 |
| 16 | 賽道庫方案比較報告 | ✅ 本輪 → [`TRACK-LIBRARY-OPTIONS.md`](./TRACK-LIBRARY-OPTIONS.md)，**等使用者二次拍板** |
| 20 | docs 分類整理（journal/ + specs/ + 本總表） | ✅ 本輪 |
| 18+19 | UX 載入 + 計算效能審計（先量測後行動） | ⏳ W2 |
| 22 | 推一版到 main | ⛔ 被 GH007（GitHub email privacy）擋住 push，待使用者處理 |

**較長期 / 跨日誌的待辦**：

- **雲端賽道庫第三階段（開放社群貢獻）**：原 §8 拍板 GitHub+jsDelivr 後暫緩，
  改等 [`TRACK-LIBRARY-OPTIONS.md`](./TRACK-LIBRARY-OPTIONS.md) 的二次拍板
  （報告建議：GitHub PR 審核層不變、分發層改 Cloudflare Worker + KV）。
- **個人雲端備份（第四階段）**：Drive vs Gist 屆時再選（CLOUD-TRACK-DESIGN.md §5/§8 決策 6/7）。
- **重視覺驗收積欠**：canvas 類（軌跡/熱力/起終點線把手/時鐘第二軸對位）無法自動驗證，
  需使用者目視——各日誌的「驗收清單」章節（尤其 [`journal/NIGHT-WORK-2026-07-05.md`](./journal/NIGHT-WORK-2026-07-05.md)、
  [`journal/EVENING-WORK-2026-07-06.md`](./journal/EVENING-WORK-2026-07-06.md)）逐項列出。
- **§11b 待辦佇列殘項**：#9 單圈 GNSS 偏移微調、F 行動裝置真機驗收（診斷面板已備 `?debug=1`）。
- **AnalyzerView 持續拆分**：[`journal/ARCH-AUDIT-2026-07-02.md`](./journal/ARCH-AUDIT-2026-07-02.md)
  點名的架構壓力點，已抽 useTrackExtrema/useTrackHeatmap/useSectors 等；剩餘耦合
  （lap-select↔zoom）**刻意保留**在 AnalyzerView 作為唯一決策點，非待辦、僅列監控。

### 已完成大項（一行一項，細節見對應日誌）

- **Testing backlog 10 項 + B7 架構稽核（B+）** → [`journal/EVENING-WORK-2026-07-02.md`](./journal/EVENING-WORK-2026-07-02.md)、[`journal/ARCH-AUDIT-2026-07-02.md`](./journal/ARCH-AUDIT-2026-07-02.md)
- **Phase5 核心（sessionAlign/sessionMerge）+ G-G 圖（echarts）+ RCNX lap 表** → [`journal/NIGHT-WORK-2026-07-01.md`](./journal/NIGHT-WORK-2026-07-01.md)
- **composables 抽取、G-G lazy-load、RS3 CSV 相容驗證、傳動設定持久化、CLOUD-TRACK-DESIGN 設計** → [`journal/NIGHT-WORK-2026-07-03.md`](./journal/NIGHT-WORK-2026-07-03.md)
- **儀表板拖曳 grid、手機摺疊/釘選、傳動重做（MT 幾何+CVT 曲線）、tracks schema v1、距離帶、轉換頁整併** → [`journal/EVENING-WORK-2026-07-03.md`](./journal/EVENING-WORK-2026-07-03.md)
- **T6 場次合併 UI、T8 卡片縮放下限、PWA precache -64%、A2/A3 第二階段（seed library）、釋出 main `742a97b`** → [`journal/NIGHT-WORK-2026-07-05.md`](./journal/NIGHT-WORK-2026-07-05.md)
- **T1–T5 使用者回饋修正（含動態圖表持久化）、輪胎三來源周長、合併預覽查證** → [`journal/EVENING-WORK-2026-07-06.md`](./journal/EVENING-WORK-2026-07-06.md)
- **2026-07-07 W1：tooltip 主題化+文案多格式化+star 按鈕（#7/12/13/14）、避震校正全格式通用（#8/9）、Web Analytics（#11）** → [`EVENING-WORK-2026-07-07.md`](./EVENING-WORK-2026-07-07.md)（進行中日誌）
- **匯入格式矩陣（loga/nmea/vbo/rcz/xrk/rcnx）+ 可插拔 Importer 架構** → 狀態見 [`IMPORT-FORMATS-STATUS.md`](./IMPORT-FORMATS-STATUS.md)，規格研究見 [`specs/`](./specs/)

---

## 12. 預留事項

- **Google Ads（#11）**：預留 lazy-load 的 `<AdSlot>` 元件位，現留空。（離線時不顯示，不影響功能。）
- **WASM**：計算模組邊界已隔離，日後可抽換。

---

## 13. 待確認 / 我已採用的預設（可隨時調整）

- 距離計算用 GPS haversine 累積（與 py 一致）。
- 圈時預設用線段自算，並提供切換成 ECU `IR_LapTime`。
- PWA 更新策略：**autoUpdate**（持續部署期間新版自動套用，避免 service worker 餵舊快取；
  原訂「提示重整」因更新提示 UI 未實作會卡舊版，故改為自動更新）。
- 單位：公制（mm / km/h / °C），未來可加切換。

---

## 附錄：討論過程摘要 (Decision Log)

- **純前端可行性**：確認可行；瀏覽器最跨平台、純地端、人機互動導向，是正確選擇。
- **Vue 不需後端**：澄清 Vue 為純前端框架，build 成靜態檔即可，部署到 Cloudflare（Workers 靜態資產）無需自寫後端。
- **語言 / 框架**：TS + Vue 3.5+（最新版）+ Composition API；務實 FP 風格。
- **架構**：由嚴格 Clean Architecture 降溫為主流 Vue feature-based，但保留純 TS `domain/` 層以利測試與解耦。
- **欄位選擇**：槽位導向 + 可搜尋下拉（桌面下拉內嵌搜尋 / 手機全螢幕挑選頁）。
- **切圈**：線段（兩端點），觸控以可拖曳把手實現；圈時可選自算或 ECU 內建。
- **底圖**：免費（上傳圖 + OSM）與衛星圖（自帶 key）兩者皆開放。
- **避震**（更正）：5 參數（min/max/zero mv、min/max mm，對齊原廠 App）；AD1/AD2 可對調。
  以「衍生通道」機制共用於轉檔器與分析器，不改寫回原始 .loga；排為 Phase 2（分析器之前）。
- **IMU 軸向**：RaceChrono 不要求 xyz 對齊，故 X/Y/Z → x/y/z 直接 1:1，不加軸向設定；
  `TC_*angle_dps` 已確認為 deg/s（與 RaceChrono gyro 同單位），`TC_*force` 為 milli-g（÷1000）。
- **iOS 相容**：以 `<input>` 為底線，File System Access API 僅作加碼。
- **效能**：Worker + Float32 column-store + 顯示降採樣；進度條。
- **重要發現**：實測有三種檔頭，RaceAMP（logger2）尚未被既有 py 支援，且為唯一含避震資料者，新專案需補。

### Phase 1 實作補充

- **RC3 槽位對應可設定**：`d2, a1~a15` 由 preset 對應 loga 欄位；固定槽位
  `xacc/yacc/zacc`(÷1000)、`gyrox/y/z`(由 `TC_*angle_dps`，無則留空)、`rpm/d1` 自動填。
  尾端空欄修剪，使 `LEGACY_PY_MAPPING` 仍與 py 黃金樣本逐欄相符。
- **兩種預設對應**：`DEFAULT_PRESET`（app 預設，使用者偏好欄位）與
  `LEGACY_PY_MAPPING`（py 相容，測試錨點）。
- **GPS-less 標準模式（新增）**：RaceAMP/logger2 無 `GPS_Valid`/`GPS_UTC`，
  改輸出純 RC3（空 time、填入 0–65535 count 欄），符合 RaceChrono 對無 GPS
  裝置的規格。Super2/SuperX 仍走 GPRMC+RC3 混合模式。
- **批次下載**：單檔直接下載；多檔以 ZIP（fflate）為主，並提供個別下載鈕。

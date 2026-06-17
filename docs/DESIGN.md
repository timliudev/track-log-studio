# aRacerLogaAnalysis — 設計文件 / Design Doc

> 本文件記錄專案的需求、技術決策與討論過程，作為實作的依據與日後維護的脈絡。
> This document records requirements, technical decisions, and the discussion log
> that shaped them. It is the source of truth for implementation.

最後更新 / Last updated: 2026-06-16

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
- **部署**：build 成靜態檔 → GitHub → **Cloudflare Pages**（純靜態，免後端 / 免 Worker）。
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

## 4. `.loga` 格式分析（實測三個範例）

三種檔頭並存，**parser 必須是「格式偵測器註冊表」**：

| 檔案 | 第一行標記 | 檔頭結構 | 取樣率 | 避震資料 |
|---|---|---|---|---|
| Super2.loga | `<Cycling Memory Log Data of Super ECU>` | 固定行：第5行群組、第6行欄名、第7行起資料 | 62.5ms (16Hz) | ❌ |
| SuperX.loga | `<aRacerX Memory Log File>` | 標記式：`<VAR NAME>` 下一行欄名、`<DATA START>` 下一行起資料 | 62.5ms (16Hz) | ❌ |
| logger2.loga | `<aRacer ECU_Memory Log Data for RaceAMP>` | `Product ID = ...; Table ID...` 單行 + 群組行 + 欄名行 + 資料 | 31.25ms (32Hz) | ✅ |

共通慣例：
- 欄名格式為 `Canonical/中文說明`，以 `/` 切開取前段作正規名。
- 資料區為純 CSV。
- 既有別名：`AFR`↔`AFR_WBO2`、`Volt_Batt`↔`Volt_Batt_indx`（見 `loga2nmea.py` 的 `ALIASES`）。

> **重點**：原 `loga2nmea.py` 只處理 Super2 / SuperX 兩種，**RaceAMP（logger2）尚未支援**，而它正是唯一含避震 `SuspensionAD1/AD2`、`Front/Rear Suspension`、`EXIN_AD1~3` 的格式。新專案需補上第三種 parser。

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

- `npm run build` → 靜態 `dist/` → push GitHub → **Cloudflare Pages** 托管。
- 純靜態 SPA/PWA，**不需要後端、不需要 Cloudflare Worker**。
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
  - **4c — 共用頂部檔案列 + 多格式輸入**：把「載入/已載入檔案」抽成全 App 共用 `fileStore`,
    轉檔器與分析器讀同一份;分析器可吃 loga + `.nmea`(讀取器已備) +（之後）`.rcz`。
  - **4d — 圈次**：起終點線、切圈(線段穿越 / `IR_LapNumber`)、單圈/全部/多圈疊圖、每圈統計表。
  - **4e — 其他圖表與互動**：G-G 點雲、分布圖、FFT（加 ECharts）；**跨圖表游標同步**
    (hover A → B 同位置顯示 value);**可拖動重排的圖表儀表板**(寬螢幕多欄,善用兩側);
    #7 框選縮放時軌跡聚焦該段；**圖表觸控手勢**(雙指/拖曳/雙擊;uPlot 縮放僅支援滑鼠);
    **軌跡圖縮放/平移**(類 Google 地圖:滾輪 + 雙指 + 拖曳;目前軌跡圖在觸控下無互動,屬待做)。
- **Phase 5 — 合併（RaceChrono GPS + loga）**：（NMEA 讀取器已於 4b 具備）當 loga 無 GPS /
  GPS 異常時，匯入 RaceChrono
  `.nmea`（`.rcz` 之後）取得好 GPS 軌跡，與 loga 引擎數據**手動時間對齊**（速度疊圖 +
  互相關建議），重新取樣後**匯出合併 .nmea**。新增 NMEA **輸入**解析器（補齊模組化輸入），
  對齊 UI 重用 Phase 4 圖表。難點：時鐘漂移（先單一位移）、取樣率內插。
- **Phase 6 — 上線準備**：**改名**（產品名 / repo / 網域 / 資料夾一次全改；去除以 aRacer /
  RaceChrono 商標當品牌，僅在副標描述相容性，例如品牌 LogaBridge 之類）、關於我頁、
  `LICENSE` + 第三方套件授權清單、SEO（meta/OG、robots.txt、sitemap、structured data）、
  Logo / favicon、使用說明連結指向外部文件（GitHub README / docs）。
- 每階段內再細分小 commit。
- **設計原則**：功能能力以**實際欄位**（`session.has(...)`）判斷，不以檔頭/格式硬編；
  檔頭僅決定如何解析結構。
- **商標**：`aRacer`（ECU 廠商）與 `RaceChrono` 皆為註冊商標，不得當品牌名，僅作相容性描述。

---

## 12. 預留事項

- **Google Ads（#11）**：預留 lazy-load 的 `<AdSlot>` 元件位，現留空。（離線時不顯示，不影響功能。）
- **WASM**：計算模組邊界已隔離，日後可抽換。

---

## 13. 待確認 / 我已採用的預設（可隨時調整）

- 距離計算用 GPS haversine 累積（與 py 一致）。
- 圈時預設用線段自算，並提供切換成 ECU `IR_LapTime`。
- PWA 更新策略：偵測新版時提示使用者「重新整理以更新」。
- 單位：公制（mm / km/h / °C），未來可加切換。

---

## 附錄：討論過程摘要 (Decision Log)

- **純前端可行性**：確認可行；瀏覽器最跨平台、純地端、人機互動導向，是正確選擇。
- **Vue 不需後端**：澄清 Vue 為純前端框架，build 成靜態檔即可，部署到 Cloudflare Pages 無需後端。
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

# 效能稽核報告 — 2026-07-08

**範圍**：只量測，不改程式碼。所有數字皆為本機（Windows 11, Node v26.4.0）實測，
未做任何 code change 於 `src/`。分支 `docs/perf-audit-2026-07-08`（從 `develop`
HEAD `0987425` 切出）。

**測試資料**：repo 內建 `test/fixtures/*.loga` 偏小且多是格式相容性樣本（部分無
GPS/圈數），不夠代表真實賽道記錄，因此改用使用者 OneDrive 中的真實 log 挑選一大
一小（唯讀來源，僅複製到系統暫存目錄量測，未動原檔、未 commit 進 repo）：

| | 檔案 | 大小 | rows | channels | GPS 定位 | 備註 |
|---|---|---|---|---|---|---|
| 小 | `aRacerLogSave/13.loga` | 2.44 MB | 4,784 | 217 | 1,770/4,784 | 有效 GPS + G-G force + RPM/Speed |
| 大 | `aracer/66621.loga` | 39.16 MB | 57,594 | 272 | 39,057/57,594 | 有效 GPS + G-G force + RPM/Speed |

（先探測過另外 ~15 個檔案；多數 ECU log 的 `IR_LapNumber` 從未遞增、GPS 也從未
`Valid='A'`，看起來是靜態/測台記錄而非賽道記錄，故換用這兩個真的有 GPS lock 的
檔案，量測才有意義。真正的「大檔」規模上限：使用者資料夾內最大達 54MB / ~256
channels，本次挑的 39MB 檔已接近上緣。）

---

## 1. 現況數字表

### 1.1 冷啟動 — bundle 尺寸（`npm run build` 實測，develop HEAD）

關鍵路徑（`index.html` 直接 `<script>` + `modulepreload`，首屏必載）：

| 檔案 | raw | gzip |
|---|---|---|
| `index-*.js`（entry） | 161.77 kB | 60.55 kB |
| `_plugin-vue_export-helper-*.js` | 110.34 kB | 42.35 kB |
| `rolldown-runtime-*.js` | 0.69 kB | 0.42 kB |
| `index-*.css` | 10.61 kB | 2.45 kB |
| **關鍵路徑合計** | **283.4 kB** | **105.8 kB** |

延遲載入（僅在使用者切到對應功能時才抓）：

| 區塊 | raw | gzip | 觸發時機 |
|---|---|---|---|
| `AnalyzerView-*.js` | 332.23 kB | 109.87 kB | 切到分析頁 |
| `ConverterView-*.js` | 25.11 kB | 9.21 kB | 切到轉換頁 |
| `SettingsView-*.js` | 1.73 kB | 0.85 kB | 切到設定頁 |
| `SuspensionCalibrationForm-*.js` | 11.03 kB | 4.48 kB | 開避震校正表單 |
| `GgChart-*.js`（echarts） | 480.14 kB | 161.92 kB | 開 G-G / XY 散佈圖 |
| `sql-wasm-*.wasm` + glue×2 | 659.73 kB + 79.25 kB | 326.10 kB + 28.12 kB | 匯入 RCNX/XRK（sql.js 讀取） |
| `parse.worker-*.js` | 30.09 kB | — | 任一檔案匯入時（背景執行緒） |

App 架構已做對：`App.vue` 用 `defineAsyncComponent` 拆三個主視圖，**所有格式解析
都在 Web Worker 執行**（`src/workers/parse.worker.ts`，涵蓋 loga/nmea/vbo/rcz/
rcnx/xrk），echarts 與 sql.js 都是 dynamic import 且被 PWA precache 明確排除
（`vite.config.ts` 的 `globIgnores`），不會拖累首屏或 SW 安裝。

### 1.2 首載時間估算（關鍵路徑 105.8 kB gzip，簡化模型：RTT + bytes/throughput）

| 網路 | 假設頻寬/延遲 | 估算首載 |
|---|---|---|
| Slow 3G | 400 kbps / 2000 ms RTT | **~4.1 s** |
| Fast 3G | 1.6 Mbps / 562 ms RTT | ~1.1 s |
| 4G（一般） | 9 Mbps / 170 ms RTT | ~0.26 s |
| WiFi | 30 Mbps / 20 ms RTT | ~0.03 s |

（模型簡化：未模擬 HTTP/2 多工的實際 waterfall，只是「總位元組/頻寬 + 一次
RTT」的粗估，且未含 JS 解析/Vue mount 時間，量級上再加 50–150ms 即可。）

**PWA 二次載入**：precache 19 entries／716.31 KiB（涵蓋 app shell + 三個視圖
chunk，故理論上連 Analyzer/Converter/Settings 切換都命中快取，唯獨 echarts 與
sql.js 刻意排除在 precache 外，改用 `CacheFirst` 於「第一次真的用到」時快取，
之後同樣命中）。二次造訪等同 0 網路（Service Worker 接管後），僅剩 JS 執行/
掛載成本。

### 1.3 解析（`parseLoga`，node bench，7 次取中位數）

| | 小檔 (2.44MB/217ch) | 大檔 (39.16MB/272ch) |
|---|---|---|
| `parseLoga` 中位數 | 64.0 ms | 834.0 ms |
| `parseLoga` min–max | 51.5–94.2 ms | 715.9–917.3 ms |
| RC3 `.nmea` 匯出 | 20.2 ms | 317.7 ms |

大檔解析時間隨「欄位數」放大明顯（272 欄 vs 小檔 217 欄，行數反而只多 12 倍
但欄位數只多 1.25 倍——時間卻是小檔的 ~13 倍，顯示成本主要來自「總 cell 數」
= rows × channels，而非單純檔案 bytes）。**此耗時發生在 Web Worker，不卡
UI 主執行緒**，這點已經是對的架構決策。

### 1.4 計算管線（domain 層函式直接 bench，5 次取中位數）

| 函式 | 小檔 | 大檔 | 說明 |
|---|---|---|---|
| `extractGpsTrack` | 0.8 ms | 4.1 ms | GPS fix 解析 |
| `detectLapsByChannel`（ECU 圈數） | 0.1 ms | 0.1 ms | 兩檔 `IR_LapNumber` 皆恆為 0，回傳 0 laps |
| `detectLapsByLine`（幾何切圈） | 0.4 ms | 1.7 ms | 用 bbox 對半線模擬真實 gate walk 成本 |
| `computeSectorTimes`（1 lap×2 gate） | 0.2 ms | 0.1 ms | |
| `computeOptimalLap` | 0.0 ms | 0.0 ms | |
| `detectCorners`（curvature，整段當 1 lap） | 1.6 ms | **33.3 ms**（另次測 20.7ms） | 目前最貴的分析函式 |
| `cornerGateLine` ×N | 0.0 ms | 1.5 ms | |
| `buildGgPoints`（全量） | 0.3 ms | 1.9 ms | |
| `buildGgPoints`（實際 UI 路徑，maxPoints=5000） | 0.2 ms | 2.6 ms | 有做抽點 |
| `deriveSuspensionChannels`（合成 AD 訊號） | 0.4 ms | 2.0 ms | 兩檔皆無真實避震通道，改用 RPM 陣列長度模擬線性轉換成本（純 elementwise，結果數值無意義但耗時具代表性） |
| `estimateCircumferenceFromLog`（輪胎倒算） | 0.1 ms | **75.1 ms** | 兩檔皆回傳 NaN（品質閘門 `minSpeed=10`/`minRpm=3000` 沒有足夠合格樣本），但完整跑過濾波+排序+叢集流程 |

大檔整條管線（GPS track → laps → sectors → corners → GG → suspension → 輪胎倒算）
全部加總 **< 120 ms**。即使拿掉「已經很快」的濾鏡，只看最貴的兩項
（`detectCorners` ~33ms、輪胎倒算 ~75ms），加總也才 ~108ms——落在一次互動的
灰色地帶邊緣，但這兩者都是「使用者主動觸發一次」的操作（開分析頁時跑一次
corner detection、按一次輪胎倒算按鈕才跑），不是每次拖曳/縮放都重算。

### 1.5 渲染（讀程式碼確認抽點現況，非即時 FPS 量測）

- **`TimeSeriesChart.vue`（uPlot 時序圖）：無抽點**。`timelineData` 直接把
  `session.get(n)!.data`（完整解析度 Float32Array）攤進 `uPlot.AlignedData`，
  對大檔就是 57,594 點 × 每條線；`downsample.ts` 裡有一個寫好且有單元測試的
  `lttb()`（Largest-Triangle-Three-Buckets）downsampler，**但整個 `src/` 只有
  它自己的檔案、自己的測試、和 `docs/DESIGN.md` 提到它，生產程式碼完全沒有任何
  地方呼叫它**——即 uPlot 圖表從未真正抽點。
- **`GgChart.vue` / `ScatterChart.vue`（echarts 散佈圖）：有抽點**。
  `ScatterChart.vue` 的 `MAX_POINTS = 5000` 常數，透過 `buildGgPoints(...,
  { maxPoints: MAX_POINTS })` 做 stride 抽點——不管檔案多大，餵給 echarts 的
  點數上限固定 5000，這條路徑沒有大檔風險。
- **`TrackMap.vue`（GPS 軌跡圖）**：同樣直接畫出所有 `track.valid[i]` 為真的
  取樣點，無抽點呼叫，但軌跡圖是一次性靜態 path（非逐幀重算的時序線），瀏覽器
  畫幾萬點的 SVG/canvas path 本身通常不是問題，互動成本主要在 hit-test/hover，
  沒有具體證據顯示這裡卡頓。
- uPlot 官方設計目標本就是「canvas immediate-mode + 大資料集仍可互動」，
  57k 點量級對它來說通常不是壓力來源；真正的風險在**更長的 session**（本次
  抽樣到的最大真實檔 54MB，若是長時間紀錄可能到數十萬列）疊加**多張儀表板卡片
  同時渲染**時才會顯現，屬於「目前沒事、但沒有安全網」的狀態。

### 1.6 記憶體（`process.memoryUsage()` 近似，非瀏覽器真值）

大檔（39.16MB/57,594 rows/272 channels）解析並跑完整條 pipeline 後：

| | 解析後 | pipeline 全跑完 | 強制 GC 後 |
|---|---|---|---|
| `rss` | 680.6 MB | 502.9 MB* | 498.1 MB |
| `heapUsed` | 313.1 MB | 128.7 MB* | 75.5 MB |
| `arrayBuffers`（Float32Array 資料） | 61.9 MB | 61.9 MB | 61.9 MB |

（*不同次執行 rss/heapUsed 有波動，`arrayBuffers` 穩定——這才是真正對應資料
本身的記憶體：57,594 rows × 272 channels × 4 bytes ≈ 62.6 MB，與量到的 61.9MB
吻合，證實 Float32 column-store 的記憶體模型如預期，沒有意外的資料複製或洩漏。）

Node 進程本身（vite-node 執行環境）就佔了 ~300MB rss 基底，瀏覽器分頁的實際
基底會不同，此數字僅用來確認「資料本身」的記憶體量級（~62MB／39MB 檔案）是
合理的，不代表瀏覽器分頁真實佔用。單一 session 的資料量遠低於瀏覽器分頁記憶體
上限（通常數 GB），單檔案案例沒有記憶體疑慮；真正該注意的是**多個 session 同時
留在記憶體**（例如 session 合併/多分頁比較功能）時的加總。

---

## 2. 對照「使用者可感知」門檻

| 項目 | 門檻 | 現況 | 是否踩線 |
|---|---|---|---|
| 首次可互動（3G） | <3s（一般） / <1s（理想） | Slow 3G ~4.1s；Fast 3G ~1.1s | 只有「刻意調到 Chrome 最慢 3G」才踩線；一般行動網路（Fast 3G 以上）都在 3s 內 |
| 首次可互動（4G/WiFi） | <3s | 0.03–0.26s | 遠低於門檻 |
| 二次載入（PWA） | 越快越好 | 近乎 0 網路（cache hit） | 已達成 |
| 單次互動延遲（拖卡片/切換/按鈕） | <100ms | 計算管線各函式 0.1–33ms（大檔最貴的單項 ~33ms） | 未踩線，即使加總「同時觸發」的最貴兩項（~108ms）也僅微幅超過，且非常態操作 |
| 大檔解析 | 使用者可接受的「等待感」開始於 ~1s | 大檔 834ms（背景執行緒，不卡 UI） | 未踩線；且因跑在 Worker，UI 本身 0 延遲，只有「資料何時就緒」的等待，非卡頓 |
| 圖表拖曳/縮放流暢度 | 60fps（<16ms/frame） | 無直接 FPS 量測；uPlot 路徑無抽點但點數量級（5–6 萬點）通常仍在 uPlot 可互動範圍內；echarts 路徑已抽點到 5000 點無風險 | 目前無具體證據踩線，但「無安全網」——更長 log 時有踩線風險 |

---

## 3. 結論

**現在不需要優化。** 以本次量到的真實檔案（39MB／57,594 rows／272 channels，
已接近使用者資料夾內檔案大小的上緣）為基準：

- 冷啟動已經做對關鍵決策（三視圖 code-split、echarts/sql.js 延遲載入且排除
  precache、解析全跑 Worker），一般網路環境（Fast 3G 以上）都在 3 秒門檻內。
- 解析與整條計算管線，即使是目前抽樣到最大的真實檔，全部函式都在
  1–35ms 級距，只有「輪胎倒算」單一動作到 75ms——都遠低於卡頓的門檻，
  且解析本身在背景執行緒完全不擋 UI。
- 記憶體量級（~62MB 對應 39MB 檔案）對現代瀏覽器分頁而言微不足道。

**若真要挑「最痛的點」，不是「現在測得到的慢」，而是「沒有安全網」**：
`TimeSeriesChart.vue`（uPlot 時序圖）完全不抽點，直接把整條 session 的原始
解析度餵進圖表——現有 `lttb()` downsampler 寫好、測過，卻從未被實際呼叫。
今天的樣本（5–6 萬點）測不出問題，但使用者資料夾裡最大的真實檔案到
54MB（且不排除有人會丟更長的多小時記錄），一旦行數再往上一個數量級，
且使用者同時開好幾張時序圖卡片，才會真正開始感受到拖曳/縮放卡頓——這是一個
「還沒發生、但已經埋好地雷」的技術債，不是急件。

---

## 4. 若要優化：按 CP 值排序的建議（給未來需要時參考）

1. **把 `lttb()` 接進 `TimeSeriesChart.vue`**（工時：0.5–1 天；風險：低）
   `downsample.ts` 的 `lttb` 已存在且有測試，純粹是「沒人接線」。做法：在
   `timelineData`／`overlayData` 組資料時，依目前可視 x 範圍（`xRange`）與
   容器寬度估一個目標點數（例如「每像素 2–3 點」），對每條 series 跑一次
   `lttb`。風險低是因為函式本身邏輯已驗證過，只是新增一層資料轉換，且不影響
   `analysis` 層（downsample.ts 檔頭本來就寫明「分析永遠用全解析度，這只是
   給畫圖用」）。**建議在「使用者回報长 log 圖表卡頓」前不必急著做**，但值得
   排進下一輪技術債清單，因為之後有真的長 log 進來時，這是唯一目前完全空白
   的防線。

2. **`TrackMap.vue` 的軌跡點加一層抽點**（工時：0.5 天；風險：低）
   同樣是「有現成的 `lttb`/stride 抽點手法可套」，軌跡圖本身是靜態 path，
   優先度比時序圖低，但同樣屬於「沒有安全網」的類別，可以跟建議 1 一起做，
   分攤設計成本。

3. **`estimateCircumferenceFromLog`（輪胎倒算）的 75ms 若要壓縮**（工時：
   0.5–1 天；風險：低-中）目前多數時間可能花在「品質閘門逐樣本掃描 +
   `clusterSorted1d` 的排序」；若要優化，可以先確認 75ms 是否真的來自排序
   （`O(n log n)`，n≈5.7萬時本就不小）——若是，這已經接近該演算法的下限，
   優化空間有限（頂多把「逐樣本 quotient 計算」那段用 TypedArray 預先過濾
   減少中繼陣列配置）。**CP 值偏低**：這是使用者「按一次按鈕」才觸發的動作，
   75ms 對單次點擊來說使用者根本感覺不到，排在最後純粹因為它是本次量測中
   數字最大的單項函式，不代表值得優先動它。

4. **`detectCorners`（curvature 路徑）的 20–33ms 若要壓縮**（工時：0.5 天；
   風險：低）同上，這是「切到分析頁 / 換參考圈」時跑一次的動作，不是逐幀成本，
   CP 值同樣偏低，除非未來有「即時調整偵測參數即時預覽」的 UI 需求（那時
   33ms 的重算會在每次滑桿拖曳時觸發，才會真的變成問題）。

5. **（觀察，非建議動手）sql-wasm 的 glue JS 被打包成兩份
   （`sql-wasm-browser-8_LZ6dh6.js` 39.62kB + `sql-wasm-browser-BAKHqIjZ.js`
   39.63kB）**——推測是主執行緒動態 import 與 Worker 內各自打包一份，屬於
   worker/main 隔離下的預期行為，總增量只有 ~40kB 且只在使用者匯入
   RCNX/XRK 格式時才下載一次、之後走 SW cache，**不建議為了省 40kB 犧牲
   worker 隔離架構的清晰度**，這裡只是紀錄觀察，不放進待辦。

---

## 5. Bench 腳本與重跑方式

腳本位置：`scripts/perf/`（`_util.ts` 共用工具、`bench-parse.ts`、
`bench-pipeline.ts`）。用 `vite-node` 直接跑 TypeScript（自動吃
`vite.config.ts` 的 `@` alias），不需要額外裝依賴（`npx` 會自動抓
`vite-node`，未寫入 `package.json`，因此本次量測未動任何 dependency manifest）：

```bash
# 不指定真實檔案 → 自動退回 test/fixtures/*.loga（數字會遠小於本報告的真實檔案版本）
npx vite-node scripts/perf/bench-parse.ts
npx vite-node scripts/perf/bench-pipeline.ts

# 指定真實檔案（要重現本報告數字，把路徑換成你自己的 .loga）——切記真實 log
# 是唯讀來源，不要複製進 repo，這兩個環境變數指到暫存目錄或原始位置皆可
BENCH_SMALL_LOGA=/path/to/small.loga BENCH_LARGE_LOGA=/path/to/large.loga \
  npx vite-node scripts/perf/bench-parse.ts
BENCH_SMALL_LOGA=/path/to/small.loga BENCH_LARGE_LOGA=/path/to/large.loga \
  npx vite-node scripts/perf/bench-pipeline.ts

# 記憶體量測想看「強制 GC 後」的數字（需要 --expose-gc）：
BENCH_SMALL_LOGA=... BENCH_LARGE_LOGA=... NODE_OPTIONS=--expose-gc \
  npx vite-node scripts/perf/bench-pipeline.ts

# bundle 尺寸：
npm run build   # 看 terminal 輸出的 dist/assets/* 尺寸表 + PWA precache 統計
```

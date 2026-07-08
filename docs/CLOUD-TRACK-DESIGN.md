# 雲端賽道機制設計文件（A2 自動套用 + A3 公開賽道庫）

> 狀態：**第一、二階段已實作**（`feature/cloud-track` 分支，未合併 develop）。
> 對應 [`docs/journal/NIGHT-WORK-2026-07-03.md`](./journal/NIGHT-WORK-2026-07-03.md) T5、
> [`docs/DESIGN.md`](./DESIGN.md) §11b「Track 獨立匯入檔 + 雲端同步（分流儲存）」點子的具體化。
> 最後更新：2026-07-05。
>
> **實作進度**（§7 分期對照，細節見分支上的 commit 訊息）：
> - ✅ 第一階段：`PersonalTrackOverlayV1` schema + 舊格式遷移（`domain/tracks/schema.ts`）。
> - ✅ 第二階段（唯讀消費公開庫）：`TrackDefinitionV1` schema 驗證、`domain/tracks/matching.ts`
>   實作 §4.2 完整流程①→②→③ + §4.3 多配置選單 + §4.4 detach，UI 接在 `TrackFilePanel.vue`。
>   **種子庫為佔位資料**（`domain/tracks/seedLibrary.ts` 2 筆明確標示為合成範例，非真實賽道座標
>   ——本機沒有真實賽道 GPS 紀錄可推導正確幾何，見該檔案註解），打通全流程但尚未有可信賽道資料。
>   §2.4 的「轉換腳本」以 `domain/tracks/contribute.ts` + UI 表單方式做成（非獨立 CLI 腳本）。
> - ⛔ 尚未做（需要本文件範圍外的外部基礎設施，或待使用者對 §8 開放問題拍板才能繼續）：
>   - 獨立 `track-log-studio-tracks` repo（§2）與其 CI（§2.3）：需要建立新 GitHub repo，
>     超出單一 worktree/PR 能完成的範圍，且 §8 問題 1/2/3 尚待使用者決策命名/授權/CDN 策略。
>   - Runtime CDN 增量更新（§3.2 step 2）：依賴上一點的獨立 repo 存在，暫緩。
>   - 個人雲端備份 Google Drive / GitHub OAuth（§5）：需要註冊 OAuth 用戶端（Google Cloud
>     Console / GitHub OAuth App），屬外部服務設定，非程式碼可獨立完成；設計文件本身也將此列
>     為第四階段（較後期），§8 問題 6 傾向延後。

---

## 0. 背景與現況（先講清楚「已經有什麼」）

在動任何設計之前，必須先弄清楚現有機制做到哪、缺什麼——避免設計出一套與現狀平行、甚至衝突的東西。

### 0.1 現有的本機賽道設定持久化（`useCircuitPersistence` + `circuitStore`）

`src/domain/persist/circuitStore.ts` 定義 `CircuitSetup`：

```ts
interface CircuitSetup {
  key: string              // 見 0.2 circuitKey
  name?: string             // 使用者可編輯的顯示名
  line: LapLine | null      // 起終點線（兩端點 lat/lon）
  gates: LapLine[]          // sector 閘門（同一線段形狀）
  columns: LapMetricColumn[] // 圈表欄位設定
  updatedAt: number
}
```

儲存在 IndexedDB（`idb`，db 名 `track-log-studio`，store `circuits`，key＝`circuitKey`）。

`src/composables/useCircuitPersistence.ts` 是**現有 A2 的一半**：

- **自動還原**：`track` 改變（切換 log 檔）→ 算出 `circuitKey` → 若 idb 有對應的 `CircuitSetup`
  → 透過 `lapStore.setLine` / `sectorStore.loadDetected` / `lapStore.addColumn` 套用，
  與使用者手動重建這套設定「不可分辨」（走同一組 store action）。
- **自動儲存**：`lapStore.line` / `sectorStore.gates` / `lapStore.columns` 任一變動
  → debounce 800ms → 寫回 idb，key 為目前 track 的 `circuitKey`。
- **這是純本機的、單使用者的**：資料只在使用者自己的瀏覽器 IndexedDB，不會被其他使用者看到，
  也**不會**自動帶到別台裝置——完全對應 A2 描述的「使用者自己的雲端備份，與共享地圖分開」
  這句話裡「使用者自己」的部分，但目前連「使用者自己」都還沒真正跨裝置（見 §5）。

`src/features/analyzer/TrackFilePanel.vue` 是**現有的「track-as-file」機制**：匯出目前
`CircuitSetup` 成一個 `.json` 檔（`track-setup-<circuitKey>.json`）給使用者下載，也可以匯入別人
給的 `.json` 檔（`importCircuitSetupJson` 做結構驗證，見 §0.3）。匯入後若剛好符合目前 track 的
`circuitKey`，立刻套用；不符合則只是存進 idb（供以後那個賽道用）。**這就是 A3「公開賽道庫」
今天唯一的雛型：手動傳檔案。**

### 0.2 幾何比對邏輯（`circuitKey`）

`src/domain/persist/circuitKey.ts`：

- 對一個 `GpsTrack`，取所有有效 fix 的 **lat/lon 中位數**（不用平均值，較不怕離群點/雜訊）。
- 四捨五入到小數點後 3 位（`GRID_DECIMALS = 3`），約 100 公尺網格 → 字串 key `"lat,lon"`。
- `circuitKeysMatch(a, b)`：兩個 key 若字串相等，或反解回經緯度後兩軸都在
  `CIRCUIT_MATCH_TOLERANCE_DEG`（10⁻³ 度、約 100 公尺）內，視為同一賽道——處理「中位數剛好落在
  網格邊界兩側」的邊界情況。

**限制（設計新機制時要記住）**：

- 這是「賽道中心點」比對，不是賽道形狀比對。**同一場地的多條配置**（例如同一園區的長/短賽道，
  或方向相反的兩種繞法）中位數可能落在同一個 100 公尺網格，會被誤判成同一賽道 → 目前的
  `CircuitSetup` 是「一個 key 一份設定」，沒有 `layoutId` 之類的次要區分（見 §4.3 待解決）。
- 沒有賽道「形狀」或「official name」資訊，只有一個匿名的地理座標——A3 需要的「這是嘉義卡丁車場」
  這種語意資訊，現有機制完全沒有，純粹是 UI 上使用者自己輸入的 `name` 欄位（自由文字、非正規化）。

### 0.3 `CircuitSetup` 的欄位驗證（匯入路徑）

`importCircuitSetupJson` 逐欄檢查型別（`key` 字串、`line`/`gates` 是合法的 `{a,b}` 端點對、
`columns` 是合法的 `LapMetricColumn[]`），格式錯誤丟 `CircuitSetupImportError` 附人類可讀訊息。
**沒有版本欄位**——目前只有一種格式，新增欄位就是破壞性變更（沒有 schema version 可以判斷
「這份 JSON 是舊格式還是漏欄位」）。這是 §6 版本化要補上的第一個洞。

### 0.4 `sectorStore` / gate 模型

`src/stores/sectorStore.ts` 的 `gates: LapLine[]` 只是**一串線段**，沒有內建的排序/命名——
排序靠 `src/domain/analysis/gateOrder.ts` 的 `sortGatesByPosition`，在有一圈參考 lap 時，
依「沿著行進方向第一次穿越的距離」排序（見該檔案的 `gatePositionOnLap`：先試線段跨越偵測，
退回最近點）。也就是說：**gate 的「順序」是衍生的，不是資料本身固有的屬性**——一份
`CircuitSetup.gates` 陣列本身不保證已排序，consumer（`sectorTiming.ts` 等）各自決定何時排序。
`edited: boolean`（是否使用者手動動過 gate）是 store 的瞬態旗標，不在持久化的 `CircuitSetup` 裡
（見 `useCircuitPersistence.ts` restore 用 `loadDetected` 而非逐一 `addGate`，刻意保持
`edited=false`，讓「還原」與「使用者手打」在後續行為上一致）。

### 0.5 「Track 檔」今天長什麼樣（實測範例形狀）

```json
{
  "key": "23.456,120.789",
  "name": "Chiayi Speedway",
  "line": { "a": { "lat": 23.4561, "lon": 120.7890 }, "b": { "lat": 23.4562, "lon": 120.7891 } },
  "gates": [ { "a": {...}, "b": {...} }, ... ],
  "columns": [ { "id": 1, "metric": { "kind": "lapTime" } }, ... ],
  "updatedAt": 1751500000000
}
```

`columns`（圈表欄位）明顯是**個人偏好**（想看哪些統計欄），不是賽道的客觀屬性——這是 §1 要拆分
SHARED / PERSONAL 時第一個要挪出去的欄位。

---

## 1. Track 檔案 Schema（versioned，SHARED vs PERSONAL 明確拆分）

### 1.1 為什麼要拆

A2 的需求原句：「個人調校習慣的微調，留在使用者自己的雲端備份，與共享地圖分開」。現有
`CircuitSetup` 是「一份設定打包所有東西」，不拆的話：

- 使用者調整圈表要顯示哪些欄位，不該被 A3 的「社群更新賽道庫」覆蓋掉（或反過來污染社群 PR）。
- 社群 PR 審查者要 review 的是「這條賽道的起終點線/sector 座標對不對」，不該混進某個人的圈表
  欄位偏好、避震顏色這種完全主觀的東西。
- 兩者的**變更頻率與信任等級不同**：SHARED 資料經 PR review、相對穩定；PERSONAL 資料使用者
  隨時調、不需要任何審查。

### 1.2 SHARED（公開賽道庫的內容，進 git PR、所有人共用）

```ts
/** 一個賽道「配置」（layout）——同一場地可能有多筆，見 §4.3。 */
interface TrackDefinitionV1 {
  schemaVersion: 1

  /** 全域唯一 id，人類可讀、穩定（PR 合併後不再改）。
   *  建議格式：`{country-iso2}-{slug}[-{layout}]`，例如 `tw-chiayi-speedway`、
   *  `tw-chiayi-speedway-reverse`。見 §2.2 命名規則。 */
  id: string

  /** 官方/常用名稱，供顯示與搜尋。多語系用物件；至少要有一個語言。 */
  name: { [locale: string]: string }   // 例如 { 'zh-TW': '嘉義卡丁車場', en: 'Chiayi Speedway' }

  /** 別名（俗名、簡稱、社群慣用拼法），供未來的「輸入建議賽道名」模糊比對用；不影響幾何比對。 */
  aliases?: string[]

  /** 地理識別：中位數/質心座標，複用現有 circuitKey 的計算方式與精度（見 §4.1）。
   *  這是「粗篩」用的，不是精確定位。 */
  geo: {
    lat: number
    lon: number
  }

  /** 國家 / 地區，供目錄結構與篩選（見 §2.3）。ISO 3166-1 alpha-2，大寫。 */
  countryCode: string

  /** 起終點線。與現有 LapLine 同形狀，直接可以丟給 lapStore.setLine。 */
  startFinishLine: { a: GeoPoint; b: GeoPoint }

  /** Sector 閘門，依行進方向排序（PR 審查時就該排好，消費端不必再猜）。 */
  gates: { a: GeoPoint; b: GeoPoint }[]

  /** 建議的圈速有效區間（給 lapTimeBand 用的合理預設），可選——非所有賽道都適合設定。
   *  單位秒。 */
  recommendedLapTimeBandSec?: { min?: number; max?: number }

  /** 賽道方向（順時針/逆時針），純資訊性 metadata，供未來 UI 顯示用；目前不影響任何計算。 */
  direction?: 'cw' | 'ccw'

  /** 資料授權（見 §8 開放問題 #7），欄位存在本身也是給消費端顯示「來源/授權」用。 */
  license: string   // 例如 'CC0-1.0'

  /** 貢獻者/最後更新資訊，PR 合併時由 CI 或維護者填，不是使用者手動填。 */
  updatedAt: string   // ISO 8601 日期（不含時間，PR 粒度足夠）
  contributors?: string[]  // GitHub username 列表
}

interface GeoPoint {
  lat: number
  lon: number
}
```

**明確排除於 SHARED 之外**（即使現有 `CircuitSetup` 有）：

| 欄位 | 現況位置 | 為什麼是 PERSONAL |
|---|---|---|
| `columns`（圈表欄位） | `CircuitSetup.columns` | 純顯示偏好，因人而異 |
| lap 對位偏移 `LapOffset`（time/dist/mapX/mapY） | `lapStore.offsets` | 每次錄製的 GNSS 漂移不同，且不曾被 idb 持久化過（本來就是 per-recording 瞬態） |
| 底圖上傳/對位 | （尚無持久化，屬 DESIGN.md §6.3） | 使用者自己上傳的圖片，版權/隱私都是個人的 |
| 傳動比 / drivetrain spec | `drivetrainStore` | 車輛規格，與賽道無關，只是恰好也常常「per 賽道」記錄哪台車開 |
| 避震校正參數 | `suspensionStore`（Phase 2） | 車輛規格 |
| 顏色/主題 | `settingsStore` / `lapColors.ts` | 純 UI 偏好 |

### 1.3 PERSONAL（使用者自己的，本機 idb 為主，未來個人雲端備份，見 §5）

沿用現有 `CircuitSetup` 精神，但**改成「對某個 SHARED track 的個人覆寫/擴充」**而非「整份獨立設定」：

```ts
interface PersonalTrackOverlayV1 {
  schemaVersion: 1

  /** 關聯到哪個 SHARED track；若使用者的賽道不在公開庫裡（見 §4.2 auto-detect 流），
   *  這裡可以是 null，退化成今天的「純本機 circuitKey-keyed」行為。 */
  trackId: string | null

  /** 沒有對應 SHARED track、或使用者想覆蓋 SHARED 起終點線/gate 時，走這條「本機獨立」路徑
   *  ——結構與 TrackDefinitionV1 的幾何欄位相同，但沒有 name/license/contributors 等公開中繼資料。
   *  當使用者「detach」一個 auto-apply 的 SHARED track（見 §4.4）時，也是把當下套用的幾何複製
   *  一份到這裡，之後就以此為準，不再跟隨 SHARED 更新。 */
  localOverride?: {
    line: LapLine | null
    gates: LapLine[]
  }

  /** 現有欄位，語意不變。 */
  columns: LapMetricColumn[]
  name?: string          // 使用者自訂顯示名（優先於 SHARED name）
  updatedAt: number
}
```

**沿用現有 circuitKey 索引**（不是用 `trackId` 當 idb 主鍵）：因為使用者本機錄到的 GPS 中位數，
才是「這次載入的 log 對應哪一份本機覆寫」唯一可靠的依據——`trackId` 是比對 SHARED 庫之後才知道的
衍生資訊，不能拿來當第一層 key（見 §4 完整比對流程）。

### 1.4 版本策略

兩個 schema 都以 `schemaVersion: number`（現在都是 `1`）開頭。細節見 §6。

---

## 2. 公開賽道庫的 repo 結構

### 2.1 獨立 repo，而非現有 repo 的資料夾——建議獨立 repo `track-log-studio-tracks`

**兩個選項比較：**

| | app-repo 內資料夾（如 `public/tracks/`） | 獨立 repo `track-log-studio-tracks` |
|---|---|---|
| PR 審查範圍 | 混在程式碼 PR 裡，或需要額外約定「只碰這個資料夾」 | 天然隔離，PR 標題/CI 就是「賽道資料」，不會誤觸程式邏輯 |
| CI 需求 | 要在主 repo 的 CI 裡額外跑 schema 驗證，與 app 的 build/test 混在一起 | 獨立、簡單的 CI（只做 JSON schema 驗證），跑得快，貢獻者容易懂要求 |
| 版本綁定 | 賽道資料版本 = app 版本（deploy 才更新），若走 bundled-at-build（見 §3）這其實是優點 | 賽道資料可獨立於 app 版本更新（若走 runtime fetch，這是必要條件） |
| 貢獻門檻 | 需要理解一點專案結構才知道資料夾在哪 | repo 本身就是「這裡放賽道」，一目了然，適合非開發者的賽道愛好者 PR |
| 授權 | 被迫跟 app 程式碼同一個授權（MIT） | 可以獨立標示 CC0/CC-BY（資料與程式碼授權語意本來就不同，見 §8 問題 7） |
| 維運負擔 | 少一個 repo 要顧 | 多一個 repo（issue/PR 通知、CI secrets 如果有的話），但 GitHub 免費 |

**建議：獨立 repo `track-log-studio-tracks`。**

理由：
1. 授權語意不同（程式碼 MIT、賽道資料建議 CC0，見 §8）在同一 repo 會混淆，獨立 repo 天然分開。
2. §3 建議的 runtime fetch 策略下，賽道資料更新不該綁 app 部署——獨立 repo 才能讓「新增一條賽道」
   不用跑一次完整的 app build/deploy pipeline。
3. 貢獻門檻對「只想加一條賽道，不想碰前端程式碼」的人更低——這正是 A3 想要的社群模式
   （類比 RaceChrono 的 track library 送審機制，但用 PR 取代封閉的送審後台）。
4. 獨立 CI（GitHub Actions）只需要「JSON schema 驗證 + 幾何合理性檢查」，比在主 repo CI 裡加一段
   簡單很多，貢獻者的 PR 檢查回饋也更快、更聚焦。

**代價**：需要多維護一個 repo；主 app 要決定「用哪個版本的賽道資料」（見 §3 的 pin/更新策略）。
評估後代價可接受——這不是高頻異動的 repo。

### 2.2 目錄結構與命名

```
track-log-studio-tracks/
├── schema/
│   └── track.schema.json          ← JSON Schema，CI 用來驗證，也給貢獻者本機先驗
├── tracks/
│   ├── tw/                         ← countryCode 小寫資料夾
│   │   ├── chiayi-speedway.json
│   │   └── taichung-kart.json
│   ├── jp/
│   │   └── suzuka-circuit.json
│   └── us/
│       └── laguna-seca.json
├── CONTRIBUTING.md
├── LICENSE                          ← CC0-1.0（見 §8 問題 7）
└── .github/
    └── workflows/
        └── validate.yml             ← PR 觸發，跑 schema 驗證 + 幾何合理性檢查
```

- **依國家分資料夾**（`countryCode` 小寫 ISO 3166-1 alpha-2），檔名 = `id` 去掉國碼前綴的
  kebab-case slug。同一場地多配置：`chiayi-speedway.json` + `chiayi-speedway-reverse.json`，
  各自完整一份 `TrackDefinitionV1`（`id` 不同、`geo` 座標可能相同或極接近）。
- 不用更深的「省/州」階層——賽道數量級（全球數千條）用國家分類已足夠避免單一資料夾檔案過多；
  真的需要可以之後再加，JSON 檔案本身找得到就好，目錄只是方便人眼瀏覽。
- **檔名即識別**：`id` 欄位其實與「國碼路徑 + 檔名」重複，但保留欄位是為了讓消費端（app）不必
  依賴檔案路徑組出 id——JSON 本身要自足（未來若改成用 API 或資料庫查詢，不該依賴檔案系統路徑）。

### 2.3 CI 驗證（PR 上跑）

`validate.yml`：
1. **JSON Schema 驗證**：每個 `tracks/**/*.json` 符合 `schema/track.schema.json`
   （用 `ajv` 或類似工具，Node 內建即可，不需要额外服務）。
2. **幾何合理性檢查**（純 JS 腳本，非 schema 能表達的規則）：
   - `startFinishLine` 與每個 `gates[i]` 的兩端點不可重合（距離 > 一個很小的 epsilon）。
   - `geo` 座標須在合理範圍（`-90..90` / `-180..180`）。
   - `id` 需符合檔案路徑（`countryCode` 小寫 + slug 對應資料夾/檔名），避免 id 與實際存放位置對不上。
   - `schemaVersion` 必須是目前 app 支援的版本（見 §6）。
3. **重複偵測（軟性警告，非擋 PR）**：新 track 的 `geo` 若與既有某條 track 的 `geo` 在
   `circuitKey` 容差內，CI 留言提醒「這可能與 `xx.json` 是同一場地，請確認是否該用
   `-reverse`/`-short` 之類的變體命名，而不是新開一條」——但不強制擋，因為多配置本來就會落在
   同一容差內，機器判斷不了「這是變體」還是「這是巧合相鄰的兩個場地」，留給人工 review。
4. **CI 通過只是必要條件，非充分條件**——仍需要至少一位維護者（repo owner）人工 approve 再合併，
   理由：幾何資料本身「對不對」（起終點線是不是真的畫在正確位置）CI 無法自動驗證，需要人看過
   （最好是比對官方賽道圖或 GPS 軌跡截圖，貢獻指南應要求 PR 附上截圖佐證）。

### 2.4 貢獻指南大綱（`CONTRIBUTING.md`）

1. 如何取得一條賽道的座標：在 Track Log Studio 匯出目前 `CircuitSetup`
   （§0.1 TrackFilePanel 既有機制）→ 用轉換腳本（待寫）轉成 `TrackDefinitionV1` 形狀，
   或直接手動填表單（提供範例 JSON 起手式）。
2. PR 附帶：賽道截圖（軌跡疊在底圖上，佐證起終點線/gate 位置正確）、資料來源
   （自己錄的 log / 官方賽道圖）。
3. 授權聲明：提交即表示同意以 repo 的 CC0 授權釋出（PR 模板加一行 checkbox）。
4. 命名衝突處理：先搜尋是否已有同場地的 track，避免重複。

---

## 3. 發行 / 抓取策略（無後端 PWA）

### 3.1 選項比較

| | Bundled-at-build | Runtime fetch（jsDelivr CDN） | Runtime fetch（raw.githubusercontent.com） | Runtime fetch（GitHub API） |
|---|---|---|---|---|
| 更新即時性 | 要重新 build+deploy app 才有新賽道 | CDN cache 預設 7 天（可用 purge API 主動清） | 幾乎即時（GitHub 自己的 edge cache 較短） | 即時，但走 API |
| 離線可用 | 天然可用（already in the bundle） | 需搭配 PWA cache（見 3.2） | 同左 | 同左，且 API 回應格式含較多雜訊需額外處理 |
| 匿名請求限制 | 無（不是 runtime request） | 官方聲明無 rate limit（大量長期使用建議先聯繫，見下方來源） | 每 IP 每小時 5000 次（2025-05 GitHub 調整後，見下方來源） | 每 IP 每小時 60 次（非常低，不可行） |
| 前端 bundle 體積 | 隨賽道數量增長，全部人下載全部賽道資料（即使只開一個 log） | 不影響 bundle，需要時才下載 | 同左 | 同左 |
| 資料完整性/防竄改 | build 時鎖定，天然可信（同源部署） | 需要子資源完整性檢查（見 3.3），因為是跨源請求 | 同左 | 同左，但 API 本身走 HTTPS + GitHub 身分，相對可信 |
| 實作複雜度 | 最簡單（build script 複製 JSON 進 `public/` 或 import 成 TS 常數） | 中等（fetch + cache 邏輯） | 中等 | 高（要處理 base64 編碼、分頁） |

**來源**：jsDelivr 官方聲明 API 無 rate limit（大量長期用建議先聯繫）；
GitHub 於 2025-05 起對未認證 raw.githubusercontent.com 請求限制約每 IP 每小時 5000 次
（[GitHub Changelog](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)）；
jsDelivr CDN 對 GitHub 內容預設快取 7 天，可用 purge API 或 GitHub Action 主動清快取
（[jsDelivr purge 文件](https://www.jsdelivr.com/tools/purge)）。

### 3.2 建議：**混合策略** —「bundle 一份 snapshot 當離線基準 + runtime fetch 增量更新（走 jsDelivr）」

理由：

- 純 bundled-at-build 違背 A3「社群持續貢獻」的精神——每加一條賽道都要求使用者更新 app
  才看得到，回饋循環太慢，也違反這個專案「純前端、無需使用者手動升級」的產品調性（PWA 是
  autoUpdate 策略，見 `DESIGN.md` §13）。
- 純 runtime fetch 犧牲離線優先（PWA 核心承諾）——使用者在賽道現場（訊號差/無網路）載入
  log 時，若還沒 fetch 過賽道庫，A2 自動套用會完全失效。
- **混合方案**：
  1. Build 時，從 `track-log-studio-tracks` repo 的**某個 tag/commit**（見下方 pin 策略）
     產生一份精簡索引（只含 `id`/`geo`/`name`，不含完整 gates——給 §4.1 快速比對用）+完整資料，
     打包進 app bundle（走 `import` 成 TS 模組或 fetch `public/` 下的靜態 JSON，build 時複製）。
     這保證**離線、首次載入即有完整的 A2 auto-apply 能力**，不依賴任何 runtime 網路請求。
  2. App 啟動後背景（不擋 UI）向 `cdn.jsdelivr.net/gh/timliudev/track-log-studio-tracks@main/`
     的一個「索引檔」（如 `tracks/index.json`，含每條賽道的 `id` + `updatedAt` + 內容 hash）
     發一次請求，比對本機 bundle 的版本 → 有新增/更新的賽道才個別 fetch 對應 JSON，
     結果快取進 IndexedDB（獨立於 `circuitStore` 的一個新 store，如 `trackLibraryStore`）。
     這個請求失敗（離線/CDN 掛）不影響任何既有功能——純粹是「錦上添花」的背景更新，
     失敗就靜默略過，下次啟動再試。
  3. **選 jsDelivr 而非 raw.githubusercontent.com**：兩者限制都遠超這個 app 的實際流量
     （個人專案，使用者量級不會逼近每小時 5000 次/IP），但 jsDelivr 官方明確聲明無 rate limit
     且是專門設計給這種用途的公開 CDN 服務，raw.githubusercontent.com 本質是「原始檔案伺服器」
     被拿來當 CDN 用、GitHub 隨時可能因濫用調整限制（如 2025-05 那次），选 jsDelivr 更穩妥。
     GitHub API 直接排除（60 次/hr 太低，且回應是 base64 編碼要額外解碼，無實質好處）。
- **Pin 策略**：build 時 pin 一個 `track-log-studio-tracks` 的 git tag（如 `v2026.07`），
  而非 `@main`——避免「賽道庫 repo 上一個還沒充分驗證的 PR 合併」直接影響所有正式環境使用者；
  runtime 增量更新的 CDN URL 則可以指向 `@main`（更新較新但因為只是「錦上添花」風險可接受）
  或同樣 pin 到 tag（更保守，犧牲即時性換穩定），**建議先保守 pin 到 tag，之後視社群 PR 頻率
  再決定要不要放寬到 @main**（見 §8 開放問題）。

### 3.3 完整性考量

- jsDelivr 提供 SRI（Subresource Integrity）hash 供 `<script>`/`<link>` 標籤使用，但這裡是
  `fetch()` 抓 JSON 不是載入 script，SRI 機制不直接適用。改為**應用層自製 hash 比對**：
  索引檔 `tracks/index.json` 內每條賽道附一個內容 hash（如 SHA-256，build 時由 CI 計算寫入），
  runtime fetch 個別賽道 JSON 後重新計算 hash 比對索引檔宣稱的值，不符則丟棄該筆、記錄警告
  （防止 CDN 中間層被竄改或傳輸損壞——不是防惡意 repo 內容本身，那個信任邊界在 PR review）。
- 全程走 HTTPS（jsDelivr 預設）。
- 賽道資料本身即使被竄改，最壞情況是「起終點線位置不準」（使用者會發現、可以 detach/手動修正，
  見 §4.4），不是可執行程式碼注入風險——這與載入第三方 JS script 的信任等級不同，屬於
  「資料完整性」而非「程式碼供應鏈安全」問題，風險本質上較低但仍值得做基本 hash 校驗。

---

## 4. 比對與優先序（Matching & Precedence）

### 4.1 幾何比對：延伸現有 `circuitKey`，不重新發明

- **索引層沿用 `circuitKey`/`circuitCentroid`**：SHARED track 的 `geo` 欄位就是用同一顆
  `circuitCentroid` 邏輯算出來的中位數（PR 貢獻者用 app 內既有的 TrackFilePanel 匯出流程
  取得，見 §2.4），比對時一樣用 `circuitKeysMatch`（含現有 100 公尺容差）。
  這保證「使用者本機曾存過的 circuitKey」與「SHARED track 庫的 geo」用同一套數學語言，
  不需要維護兩套地理比對邏輯。
- **不改動 `CIRCUIT_MATCH_TOLERANCE_DEG`**：目前 100 公尺對絕大多數賽道（動輒數百公尺到數公里
  長）而言，起點區域的中位數波動遠小於這個容差，不需要調整。若之後發現大量誤判（見 §4.3）
  再檢討，不在本次設計預先放寬/收緊。

### 4.2 載入時的完整比對流程（A2 auto-apply）

```
載入一個 log（有 GPS track）
  │
  ▼
算出 candidateKey = circuitKey(track)
  │
  ├─ candidateKey === null（無 GPS）→ 不做任何 auto-apply，維持現狀（使用者手動畫線）
  │
  ▼
① 查本機 PersonalTrackOverlay（idb，key = candidateKey，複用現有 circuitStore 索引）
  │
  ├─ 命中 → 套用 localOverride（若有）或依 trackId 從 SHARED 庫取幾何 + 套用 columns/name
  │         【最高優先序：使用者對這個地理位置已經有明確的個人設定，永遠尊重】
  │
  ▼（未命中）
② 查 SHARED track 庫（bundle + idb 快取，用 circuitKeysMatch 比對 candidateKey 對每條 geo）
  │
  ├─ 恰好命中一條 → auto-apply（見下方「auto-apply 的實際動作」），並在 idb 寫一筆
  │                  PersonalTrackOverlay { trackId, localOverride: undefined, columns: [] }
  │                  作為「已套用過 SHARED track X」的記錄，讓下次載入同一 circuitKey 時
  │                  流程②本身仍會命中同一條（idempotent），但流程①優先命中這筆記錄，
  │                  跳過重新掃描 SHARED 庫（也讓「使用者是否已 detach」的狀態有地方存，見 §4.4）
  │
  ├─ 命中多條（同場地多配置，§4.3）→ 不自動選，UI 顯示「偵測到 N 個可能的賽道配置」清單
  │                                    讓使用者選一個（選完視同流程②的單一命中，繼續套用）
  │
  ▼（完全未命中）
③ 退回現有行為：不套用任何東西，等使用者手動畫起終點線／sector
   （沿用今天 useLaps 的「自動播種預設線」邏輯，不變）
```

**auto-apply 的實際動作**：與 §0.1 `useCircuitPersistence.ts` 現有的 restore 邏輯完全相同的
「透過 store action 套用，不直接改 ref」原則——`lapStore.setLine(shared.startFinishLine)`、
`sectorStore.loadDetected(shared.gates)`。**這代表 A2 這一段的核心程式改動，其實是
`useCircuitPersistence.ts` 的 restore 來源從「只查本機 idb」擴充成「本機 idb → SHARED 庫」
兩層查詢**，套用機制完全重用，不需要新寫一條套用路徑（見 §7 實作分期）。

### 4.3 同場地多配置（未解決的現有限制，本設計提出的處理方式）

如 §0.2 所述，`circuitKey` 是「賽道中心點」，同場地的正/反繞法或長短配置常落在同一容差內。
本設計的處理方式：

- SHARED 庫允許多筆 `TrackDefinitionV1` 有相同/相近 `geo`（不同 `id`）——這是**允許的**，
  不是要靠幾何強行去重。
- §4.2 流程②「命中多條」時，UI 呈現清單讓人選——**不嘗試自動判斷該選哪一條**
  （形狀比對是更複雜的問題，例如比對起終點線方位角、或整條軌跡的 Fréchet 距離，超出本次
  設計範圍，列為 §8 未來可能的優化方向，非本階段必做）。
- 使用者選定後，該選擇被記錄進 `PersonalTrackOverlay.trackId`（§4.2 流程①），所以**只需要選
  一次**——下次同一場地的 log 進來，流程①直接命中，不會每次都跳出選單。

### 4.4 使用者覆蓋 / detach 流程

「使用者調整後」與「使用者想切回全新偵測」要能互相切換，UI 層面對應現有 SectorPanel 的
`edited` 概念（§0.4），延伸到整個 track 層級：

- **調整（不 detach）**：使用者 auto-apply 後手動拖曳起終點線/gate → 這些改動照現有
  `useCircuitPersistence` 的 auto-save 邏輯寫回 `PersonalTrackOverlay.localOverride`
  （優先序見 §4.2 流程①，之後永遠讀本機這份，不再受 SHARED 庫更新影響）。
  **這與現行為完全一致**——現有 auto-save 邏輯不必改，只是儲存的資料結構從「獨立一份設定」
  變成「基於 trackId 的 overlay」。
- **明確 detach（回到跟隨 SHARED 更新）**：UI 提供一個「回復為賽道庫預設值」的動作
  （放在 TrackFilePanel 或新的 TrackLibraryPanel），清除 `localOverride`，讓流程①的
  「命中但 localOverride undefined」分支重新套用當下的 SHARED 庫版本（可能已隨 PR 更新）。
- **完全解除關聯**：刪除整筆 `PersonalTrackOverlay`（沿用現有 `deleteCircuitSetup` 概念）
  →下次載入同 circuitKey 的 log，流程②重新跑一次 SHARED 庫掃描（若同場地多配置，重新問一次）。

---

## 5. 個人雲端備份（無後端前提下的選項）

**此節標記為較後期階段**（§7 分期實作的最後一塊），先列選項與建議方向，不含實作細節。

| 選項 | 使用者需要做的事 | 優點 | 缺點 |
|---|---|---|---|
| **維持現狀：手動 JSON 檔匯出/匯入**（TrackFilePanel 既有機制） | 手動存檔、自己決定放哪 | 零額外複雜度，已經存在，完全無後端無第三方帳號依賴 | 不是「同步」，使用者要記得手動做，換裝置要手動搬檔案 |
| **使用者自己的 GitHub Gist**（OAuth Device Flow 或 Personal Access Token） | 登入 GitHub 帳號一次 | GitHub 帳號在目標族群（賽道玩家會用 GitHub 機率中等，但開發者用戶群高）中不算陌生；Gist API 免費、簡單（純 JSON GET/PATCH）；資料仍是使用者自己的 repo/gist，符合「不上傳到我方伺服器」的純前端承諾 | 需要 OAuth flow（純前端 PWA 做 OAuth 通常需要一個轉發 redirect 的最小後端或用 GitHub 的 Device Flow，見下方細節）；一般玩家（非工程師）建立 GitHub 帳號的門檻偏高 |
| **Google Drive（appDataFolder scope）** | 登入 Google 帳號 | 使用者族群 Google 帳號普及率極高，門檻低於 GitHub；`drive.appdata` scope 資料對使用者不可見於自己的 Drive UI（純 app 私有儲存），符合「不需要使用者管理檔案」的簡潔性 | Google OAuth Client 設定需要一個已驗證的 OAuth consent screen（未驗證應用有使用者上限與警告畫面，體驗較差）；仍是「使用者的雲端帳號」而非我方後端，但 OAuth 流程複雜度不低 |
| **WebDAV / 使用者自帶儲存（Dropbox API 等）** | 依服務而定 | 選項多樣 | 每多一個選項就多一套整合維護成本；本專案沒有既有整合可參考，優先度低 |

**建議方向**：**Google Drive（`drive.appdata` scope）優先於 GitHub Gist**，理由：

1. 目標使用者（業餘賽車/卡丁車玩家）Google 帳號普及率遠高於 GitHub 帳號，門檻更低——這與
   A3（面向社群貢獻者，天然更懂 git/GitHub）的受眾不同，A2 的個人備份面向**所有**使用者。
2. `drive.appdata` 是專門為這種用途設計的 scope（app 私有資料，不佔用使用者可見的 Drive 空間、
   使用者看不到雜亂檔案），比 Gist（公開或需要額外設定成 secret gist）更貼近「純個人備份」語意。
3. 純前端 OAuth（Google Identity Services，`implicit` 或 PKCE flow）可以完全不需要自寫後端
   ——與這個專案「無後端」的鐵則相容；GitHub OAuth 傳統上需要一個 client-secret 交換步驟
   （通常要一個小後端/proxy），雖然 GitHub 也支援 Device Flow 可避免，但整體上 Google 的
   純前端 OAuth 生態更成熟直接。

**仍是後期階段**——目前 TrackFilePanel 的手動匯出/匯入已經滿足「有備份能力」的最低需求，
只是不夠自動化。此節列出方向是為了讓 §1.3 的 `PersonalTrackOverlayV1` schema 設計時，
**格式本身要與未來雲端同步無關**（純資料結構，不綁定任何特定雲端 API 的欄位），
不在這次設計花時間深究 OAuth 細節。

---

## 6. 版本化 / 遷移規則

- 兩個 schema（`TrackDefinitionV1` / `PersonalTrackOverlayV1`）都以 `schemaVersion: number` 開頭，
  現行皆為 `1`。
- **前向相容規則**：
  - **新增可選欄位**：不需要 bump `schemaVersion`（消費端用 `field ?? default` 處理缺欄位，
    與現有 `importCircuitSetupJson` 對 `name?: string` 的處理方式一致）。
  - **改變既有必填欄位的型別/語意、或移除欄位**：必須 bump `schemaVersion`，消費端
    （app 內的 parser，類比現有 `importCircuitSetupJson` 但延伸出 `parseTrackDefinition`/
    `parsePersonalOverlay`）依 `schemaVersion` 分支處理，舊版本資料**盡力轉換**成當前內部
    使用的形狀（例如 v1→v2 若某欄位改名，parser 內部做欄位搬移），無法轉換的部分寧可丟棄該筆
    整條資料並記錄警告，不要讓一筆壞資料讓整個 SHARED 庫載入失敗（現有 `CircuitSetupImportError`
    的「單筆匯入失敗清楚報錯」精神，延伸成「SHARED 庫裡某筆壞掉不能拖累其他筆」）。
  - app 端固定「目前支援讀取的 schemaVersion 範圍」（如 `SUPPORTED_TRACK_SCHEMA = [1]`），
    CI 驗證（§2.3）也用同一個常數，確保 repo 裡的資料版本 app 一定讀得懂——**這代表這個常數
    需要在 app repo 與 tracks repo 之間有某種同步機制**（最簡單的做法：tracks repo 的
    `schema/track.schema.json` 本身就是 source of truth，app repo 的驗證邏輯定期手動對齊，
    不做自動化同步，因為版本 bump 頻率預期很低）。
- **`PersonalTrackOverlayV1` 的版本化更保守**：這是存在使用者自己 idb 裡的資料，跨 app 版本
  要能讀（使用者不會因為 app 更新就遺失本機設定）——沿用現有 `circuitStore` 完全沒有版本欄位
  仍能運作的事實（因為至今只有一版），但新設計**一開始就加上 `schemaVersion`**，避免重蹈
  「早知道就先加」的覆轍。

---

## 7. 分期實作計畫

### 第一階段（最小可用切片）——**只動本機，不碰公開庫**

目標：把 §4.2 的「流程① 本機 PersonalTrackOverlay」與現有 `useCircuitPersistence` 對齊，
**釐清現有機制其實已經做到什麼、缺什麼**：

- 現有 `useCircuitPersistence.ts` **已經是流程①的完整實作**（本機 idb 命中即自動套用）——
  這部分不需要新工，只需要：
  1. 把 `CircuitSetup` 的形狀往 `PersonalTrackOverlayV1` 靠攏（拆出 `columns` 之外的欄位，
     幫未來留 `trackId` 的位置——但因為還沒有 SHARED 庫，這階段 `trackId` 永遠是 `null`，
     行為與現狀完全相同）。
  2. 加上 `schemaVersion` 欄位（§6），此階段唯一的「新行為」。
- **明確缺的東西**：SHARED 庫査詢（流程②）完全不存在——今天没有 SHARED track 這個概念，
  TrackFilePanel 的「匯入」是使用者手動一筆一筆餵，不是自動比對一個公開庫。
- 驗收：現有 509 個測試全過（這階段是重構/加欄位，非行為變更），新增 schemaVersion
  往返（round-trip）測試。

### 第二階段——消費公開庫（唯讀）

- 建立 `track-log-studio-tracks` repo（§2），先手動放 3-5 條種子賽道（開發者自己熟悉的場地）
  驗證流程，不急著開放大量社群 PR。
- app 端新增 `trackLibraryStore` + fetch 邏輯（§3.2 混合策略：bundle snapshot + jsDelivr
  背景更新），實作 §4.2 完整比對流程（①②③ 全部串起來）。
- UI：auto-apply 時的提示（「已自動套用『嘉義卡丁車場』賽道庫設定，可在下方調整或改回手動」）+
  §4.3 多配置選單 + §4.4 detach 按鈕。
- 驗收：至少一條種子賽道能在全新瀏覽器 profile（空 idb）載入 log 後自動套用正確的起終點線。

### 第三階段——開放社群貢獻

- 補完 CONTRIBUTING.md、PR 模板、CI schema 驗證（§2.3）跑起來。
- 公告/邀請社群 PR（超出本次技術設計範圍，屬營運）。

### 第四階段——個人雲端備份

- 依 §5 建議方向（Google Drive appDataFolder）評估、設計 OAuth 流程細節（本文件不含）。
- 這階段可能發現「手動 JSON 匯出/匯入」已經夠用、優先度不高——按實際使用回饋決定是否要做。

---

## 8. 待使用者決策的開放問題

> **✅ 決策紀錄(2026-07-07 使用者拍板):**
> 1. **Repo**:採 `track-log-studio-tracks`,同一 GitHub 帳號下。討論過替代方案後確認維持 GitHub+jsDelivr(PR 協作生態不可替代;短期也只有這一個 repo 要開,個人備份走使用者自己的雲端)。
> 2. **授權**:CC0-1.0。
> 3. **CDN**:跟 `@main`,審核合併即生效(接受 CDN 快取延遲數小時)。
> 4. **種子賽道**:使用者之後提供清單。
> 5. **多配置**:自動套用「預設配置」+ 提供選單可手動切換其他配置(非跳窗中斷、也非放棄處理)。
> 6/7. **個人雲端備份**:維持第四階段(後期),Drive vs Gist 屆時再選。
> 8. **TrackFilePanel 手動匯出/匯入**:保留(依本文件原假設,貢獻流程依賴它)。
>
> 阻塞已解除:下次夜班可建 repo、上 CI、接 runtime @main 增量更新(§2、§3.2)。
>
> **⏸️ 重新考慮(2026-07-07 晚間)：** 使用者出門前提出「git repo 是否為最佳解、有無更好免費方案
> （如 Firebase）」的疑問，故上述決策**暫緩動工**，先產出
> [`TRACK-LIBRARY-OPTIONS.md`](./TRACK-LIBRARY-OPTIONS.md) 重新比較 GitHub+jsDelivr / Firebase /
> Cloudflare KV·R2·D1 / Supabase 四個方案，待使用者回來二次拍板後再建 repo。該報告建議**混合方案**：
> 貢獻/審核層維持本節的 GitHub PR 流程不變（§1/§2 的 schema、repo 結構、CI、貢獻指南全部照舊），
> 只把 §3.2 的 runtime 分發層從 jsDelivr 換成 Cloudflare Worker + KV（本專案已有 Cloudflare 帳號與
> 部署流程，整合成本最低）。

1. **獨立 repo 命名確認**：本文件建議 `track-log-studio-tracks`（與 app repo `track-log-studio`
   對應），是否採用？是否要放在同一個 GitHub 帳號/org 下？
2. **賽道資料授權**：建議 **CC0-1.0**（公眾領域，最大化社群自由使用/衍生，類似 OpenStreetMap
   的資料授權精神），而非 CC-BY（需要標示來源，對「起終點線座標」這種事實性資料而言標示來源
   意義不大、反而增加 PR 貢獻者的心理負擔）。是否同意，或偏好 CC-BY 保留貢獻者掛名？
3. **CDN pin 策略的積極程度**：§3.2 建議 build 時 pin git tag、runtime 增量更新也先保守 pin
   tag——這代表「社群新增一條賽道」不會立刻對所有使用者生效，要等下一次 tag/release。
   是否接受這個延遲（換取穩定性），或希望 runtime 更新直接跟 `@main`（新賽道審核合併後
   數小時內〔受 CDN 快取影響〕就能被所有使用者看到）？
4. **首波種子賽道**：第二階段要先手動放 3-5 條熟悉的賽道驗證流程——是否已有明確的候選清單
   （例如目前測試/開發常用的那幾個賽道）？
5. **多配置 UI 的優先度**：§4.3 「同場地多配置」目前設計為「跳出選單讓使用者選」，是否可接受
   這個中斷體驗，或希望第一階段乾脆先不處理多配置（只支援每個地理位置恰好一條賽道，
   命中多條時退回③「不自動套用」而非跳選單），把選單留到後期？
6. **個人雲端備份的急迫性**：§5 建議列為第四階段（較後期）。是否同意延後，或這其實是使用者
   近期就想要的功能，需要提前排期？
7. **GitHub Gist 選項是否仍要保留**：§5 建議 Google Drive 優先，但若使用者本身更習慣 GitHub
   生態（考慮到這是一個工程師向的專案，主要使用者可能包含相當比例的開發者背景賽道玩家），
   是否希望兩個選項都做，或是先只做一個？
8. **與現有 TrackFilePanel 手動匯出/匯入的關係**：新機制上線後，現有「匯出/匯入單一
   `.json` 檔」功能是否保留（作為離線分享/備份的補充手段，與 §2.4 貢獻流程的「先匯出再轉成
   PR」步驟本來就需要它），還是最終要被新 UI 完全取代？本文件假設**保留**（§2.4 的貢獻流程
   依賴它），但介面上可能需要重新定位說明文字，請確認方向是否正確。

---

## 附錄：本設計未涵蓋（明確排除範圍）

- 賽道形狀（非中心點）比對演算法的技術細節（§4.3 提及但列為未來優化，非本階段設計）。
- Google Drive / GitHub OAuth 的實際流程圖與 API 呼叫細節（§5 只列選項比較與建議方向）。
- CI workflow 的實際 YAML 內容、schema 驗證工具的技術選型細節（ajv vs 其他，留待實作時決定）。
- UI 視覺稿（本文件描述互動流程與資料流，不含畫面設計）。

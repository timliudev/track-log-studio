# 格式轉換架構：Importer / Exporter / LogSession

> 對象：開發者文件。說明 Track Log Studio（Vue 3 + TypeScript 純前端 PWA）如何把
> 各種記錄檔解析成內部模型、如何匯出，以及如何新增格式。
> 程式碼識別符以原文呈現，敘述為繁體中文。

本文涵蓋「可插拔 Importer 架構」（與既有 Exporter 對稱），以及兩者目前的不對稱與
擴充計畫。二進位 / ZIP 格式的格式層研究（XRK / RCZ / Qstarz）見
[`FORMAT-SUPPORT-RESEARCH.md`](./specs/FORMAT-SUPPORT-RESEARCH.md)，本文不重複，只說明它們要怎麼接進架構。

---

## 1. 總覽圖：一份檔案的資料流

從使用者選檔到分析器 / 匯出，資料流如下：

```
File (使用者選檔 / 拖放 / 解壓自 .zip)
  │
  ▼  FileBar.vue：importOne(file)
sniff(file)                         讀檔案前 4096 bytes 解成文字 → ImportCandidate { fileName, headText }
  │
  ▼
detectImporter(candidate)           走訪 IMPORTERS，第一個 detect()==true 勝出 → Importer
  │  (找不到 → 標記 unsupported)
  ▼  parseFile(file, imp.id)（useLogImport）
postMessage({ id, importerId, file }) ──► Web Worker (parse.worker.ts)
                                            │
                                            │  WORKER_PARSERS[importerId](text, onProgress)
                                            │  → Importer.parse → LogSession
                                            │
                                            │  序列化：channels[{name,rawName,description,data}] + meta
                                            ▼
  ◄── postMessage({ kind:'done', channels, meta }, transfer=[...buffers])  零拷貝轉移 Float32Array buffer
  │
  ▼  rebuildLogSession(channels, meta)（主執行緒）
LogSession（重新 new，含 byName 索引、alias 解析）
  │
  ├──► 分析器（軌跡 / 圖表 / 切圈 / FFT）
  └──► Exporter（RaceChrono .nmea / .loga patch / .vbo）
```

關鍵點：

- **偵測（detect）在主執行緒**，只看檔名與前 4 KB 文字，成本低。
- **解析（parse）在 Web Worker**，因為真實 log 可達約 54 MB，不能阻塞 UI。
- **LogSession 物件本身不跨 worker 邊界**；只有「序列化的 channels + meta」會被
  `postMessage`，且 `Float32Array` 的底層 buffer 以 **transfer（零拷貝）**移交。主執行緒再用
  `rebuildLogSession` 重新 `new LogSession(...)`（見 §2）。

---

## 2. 核心模型：LogSession / Channel / LogMeta

定義於 `src/domain/model/`：

- **`Channel`**（`types.ts`）：一個具名資料欄，**以 `Float32Array` 做欄式（column-store）儲存**。
  ```ts
  interface Channel {
    readonly name: string          // 正規化名稱，例如 'RPM'（'/' 之前的部分）
    readonly rawName: string       // 原始檔頭，例如 'RPM/引擎轉速'
    readonly description: string | undefined  // '/' 之後的說明（若有）
    readonly data: Float32Array    // 每列一個取樣值
  }
  ```
  空白 / 無法解析的格子存成 `NaN`，讓消費端能分辨「無值」與「真正的 0」。

- **`LogMeta`**（`types.ts`）：檔頭衍生的中繼資料。
  ```ts
  interface LogMeta {
    readonly formatId: string                         // importer 各自的格式識別符
    readonly createdDate: Date | null
    readonly headerInfo: Readonly<Record<string, string>>
  }
  ```
  **`formatId` 現在的型別是 `string`**（已從早期的 `.loga` 列舉放寬）。`.loga` 解析仍產出
  `LogaFormatId`（`'super2' | 'superX' | 'raceAmp' | 'mxApp' | 'nmea'`）這個子集；新 importer
  （如 VBO 用 `'vbo'`）可自帶識別符。FileBar 的檔案 pill 直接顯示這個 `formatId`。

- **`LogSession`**（`LogSession.ts`）：`Channel[]` + `LogMeta` 的封裝，外加：
  - `byName` Map 與 **alias 感知**的 `get(name)`（透過 `aliasCandidates`，讓呼叫端用邏輯訊號名
    而非各韌體的欄名）。
  - 衍生 getter：`rowCount`、`timeChannel`、`sampleIntervalMs`、`sampleRateHz`。

### 為何 LogSession 不能跨 postMessage

`LogSession` 是一個**帶方法與內部 `Map`（`byName`）的 class 實例**。`postMessage` 用
structured clone 演算法，它**不保留 class 原型與方法**，clone 後只會是一個普通物件，`get()` /
`timeChannel` 等方法全失。因此 worker 不傳 `LogSession`，而是：

1. Worker 內 `Importer.parse` 產出 `LogSession`，但只取出可序列化的部分——
   `channels` 陣列（純資料物件）與 `meta`（純資料）。
2. 以 `transfer` 清單把每個 channel 的 `data.buffer` **零拷貝轉移**給主執行緒
   （見 `parse.worker.ts` 的 `transfer = channels.map(c => c.data.buffer)`）。轉移後 worker 端
   的這些 buffer 即失效，省去複製數十 MB 的成本。
3. 主執行緒收到 `{ kind:'done', channels, meta }`，呼叫 `rebuildLogSession(channels, meta)`
   （`rebuildSession.ts`）**重新 `new LogSession(...)`**，方法與索引在主執行緒這側重建。

序列化的形狀定義在 `parseProtocol.ts` 的 `SerializedChannel` / `ParseResponse`。

---

## 3. Importer 介面與 registry

### 介面（`src/domain/import/Importer.ts`）

```ts
interface ImportCandidate {
  readonly fileName: string   // 已轉小寫，例如 'run01.loga'
  readonly headText: string   // 檔案前幾 KB 解成文字，供內容嗅探
}

type ImportProgress = (fraction: number) => void

interface Importer {
  readonly id: string                     // 穩定 id，例如 'loga' / 'nmea' / 'vbo'
  readonly extensions: readonly string[]  // 不含點，例如 ['loga']
  detect(candidate: ImportCandidate): boolean
  parse(text: string, onProgress?: ImportProgress): LogSession | Promise<LogSession>
}
```

逐欄位：

- **`id`**：穩定字串。同時是 worker 端 `WORKER_PARSERS` 的鍵（§5），所以**註冊與 worker 兩處
  必須用同一個 id**。
- **`extensions`**：不含點的副檔名。驅動 `<input accept>` 與 zip 白名單（見下）。
- **`detect(candidate)`**：判斷此 importer 是否認得這個檔案。策略是**「副檔名 + 內容嗅探」**：
  - 先看 `fileName` 副檔名（快速、常見情形）；
  - 副檔名不可靠時，**嗅 `headText` 才是權威答案**。例如：
    - `loga`：`fileName.endsWith('.loga')` **或** 第一行能被 `detectFormat` 認出（即使副檔名不是 .loga）。
    - `nmea`：`fileName.endsWith('.nmea')` **或** `headText` 出現 `$GPRMC` / `$GNRMC` 句首。
    - `vbo`：`fileName.endsWith('.vbo')` **或** `headText` 含 `[header]` 區段標記。
- **`parse(text, onProgress?)`**：把整份文字解析成 `LogSession`，必須 async-capable 並回報
  `[0,1]` 進度；無法辨識 / 內容無效時 **throw**（由 FileBar 轉成失敗的 pill）。

### Registry（`src/domain/import/registry.ts`）

```ts
const IMPORTERS: readonly Importer[] = [logaImporter, nmeaImporter, vboImporter]

async function sniff(file: File): Promise<ImportCandidate>   // 讀前 4096 bytes
function detectImporter(candidate: ImportCandidate): Importer | undefined  // first-match-wins
function allImportExtensions(): string[]                     // 所有副檔名（不含點）
```

- **`sniff(file)`**：`fileName` 轉小寫 + `file.slice(0, 4096).text()` 當 `headText`。
- **`detectImporter`**：`IMPORTERS.find(imp => imp.detect(candidate))`——**順序決定優先權，第一個命中的勝出**。
  - 為何重要：當未來新增**泛用副檔名**（例如多種來源都用 `.csv`）時，**較專一的 importer 必須排在
    泛用的之前**，且專一者要靠 `headText` 內容嗅探，避免被泛用者先攔截。目前三個格式副檔名互斥，
    順序尚不敏感，但設計上必須維持此不變式。
- **`allImportExtensions()`**：把所有 importer 的 `extensions` 攤平。**這是副檔名的單一真實來源**：
  - `FileBar.vue` 的 `acceptExtensions` 用它組出 `<input accept>`（再加上 `.zip`）；
  - `zip.ts` 的 `extractLogFiles` 用它當**解壓白名單**——zip 內只有副檔名在此清單者才會被
    inflate，其餘（script、README、執行檔）一律略過。
  - 因此**新增 importer 時不必同步改 FileBar 或 zip**：副檔名自動流通。

---

## 4. 目前支援矩陣

> **本表 = 架構對應**（每個格式 ↔ importer/exporter/formatId/decoder 的 how），是這件事的唯一真實來源。
> **完成進度、已知限制、待完成清單**不在此重列，見 [`IMPORT-FORMATS-STATUS.md`](./IMPORT-FORMATS-STATUS.md)。

| 格式 | 可匯入? | 可匯出? | formatId | 備註 |
|---|---|---|---|---|
| aRacer `.loga` | ✅ `logaImporter` | ✅（就地 patch） | `super2` / `superX` / `raceAmp` / `mxApp`（`LogaFormatId` 子集，含 `nmea`） | 匯出走 `patchLogaText`（`LogaWriter.ts`）：把指定 channel 寫回原始 .loga 文字，既有欄覆寫、缺欄附加，其餘逐字保留；非 registry 化的 Exporter |
| RaceChrono `.nmea` | ✅ `nmeaImporter` | ✅（RC3 NMEA） | `nmea`（匯入時）；偵測靠 `$GPRMC` / `$GNRMC` | 匯出由 `Rc3NmeaExporter`（實作 `Exporter`）產生 NMEA0183 `$GPGGA`+`$GPRMC`+`$RC3`；`export()` **多吃一個 mapping 參數**（見 §7） |
| RaceLogic `.vbo` | ✅ `vboImporter` → `parseVbo` | ✅（但非單純對稱，見備註） | `vbo` | 匯入：解析 `[header]`/`[channel units]`/`[column names]`/`[data]`，座標反轉與匯出鏡像，可 round-trip。匯出：`convertToVbo` 是 **free function**，一份來源產出 **多個產物**——`_ct.vbo`（Circuit Tools，原始 ECU 名）、`_rc.vbo`（RaceChrono `rc_` 識別符 + 內嵌 channel map）、`_channels.csv`（對照表）；非 registry 化 |
| AiM XRK | ✅ `xrkImporter` → `parseXrk`（**二進位**） | ⬜ | `xrk` | 扁平 LE 訊息流（H-訊息 header+payload+footer 含 checksum + sample 訊息 `(S`/`(M`）。CNF/CHS 為 channel 表（112B 記錄：短/長名、size、單位、decoder、取樣率）；decoder 含 int16/float16/int32/gear。各 channel 取樣率不同 → 以 MCLK 為主軸重採樣。GPS 為 ECEF X/Y/Z（cm）→ Bowring 轉 WGS84 經緯度。真檔驗證：95890 列/27 channels/座標正確/圈時 ~48s。規格見 XRK-FORMAT-SPEC.md。（`.xrz` = zlib 壓縮的 .xrk，`parseXrk` 偵測 RFC 1950 magic 後以 `inflateXrz`（`fflate` `Unzlib` 串流，含解壓炸彈防護）還原成 `.xrk` bytes 再走同一 parser，**已支援**） |
| RaceChrono RCZ | ✅ `rczImporter` → `parseRcz`（**二進位**） | ⬜ | `rcz` | **第一個二進位 importer**（用了 §6 的 `parseBinary`/`headBytes` 擴充）。ZIP（fflate 解）+ `session.json`（含每圈時間/track 名）+ 每通道一個 raw 數值檔（type 0=int32／1=int64／3=float64，LE）。channel id = `k*2²⁰+lo`：`lo=5000→rc_analog_k`、`5001→rc_digital_k`、其餘查 `NAMED_LO`。GPS lat/lon 為 int32 配對 `/6e6`、速度 mm/s、heading 毫度；GPS↔ECU 以各自 int64 時間戳最近鄰對齊。真檔驗證：17791 列／147 channels／座標正確。**另支援 RaceChrono「整機備份」`.rcz`（F3）**：同副檔名、不同結構（多場巢狀 `sessions/session_<KEY>/`），`listRczSessions`／`parseRczBackupSession`（`src/domain/import/rcz/`）以 fflate `unzipSync({filter})` 做**選擇性 inflate**（列場次只解小 JSON、載入只解選中場），是本專案第一個必須避免整檔解壓（OOM）的 importer；裝置角色由 `sessionfragment.json` `devices[].type` 推導（GPS=1），master clock 取樣本數最多者，其餘最近鄰對齊 |
| Qstarz `.rcnx`（LT-Q6000/Q6000S） | ✅ `rcnxImporter` → `parseRcnx`（**二進位/SQLite**） | ⬜ | `rcnx` | ZIP 內含每場 `sess_N.db`（標準 SQLite）。用 **`sql.js`（WASM，動態載入、PWA 預快取 `**/*.wasm`）** 讀 `WayPoints` 表；多 session 取列數最多者。lat/lon 十進位度（無縮放）、speed km/h、Gx/Gy/Gz g。真檔驗證 22402 列/座標正確/TWN-ARK/LT-Q6000。規格見 RCNX-FORMAT-SPEC.md。（`sana_N.db` 的官方圈資料、多 session 全展開為後續增強） |
| 通用 `.csv` | ✅ `csvImporter` → `parsePlainCsv` | ✅ `convertToCsv`（registry `id: 'csv'`） | `csv` | RFC 4180 逗號分隔資料；第一個非空白列為標題，需有唯一 `Time` 或 `Timer`（不分大小寫）。支援 BOM、CRLF、引號/轉義引號與 quoted newline；空白/無效數值為 NaN，`TLS_Metadata` 欄只還原可攜註記而不成為通道。配置先驗證再配置 Float32Arrays，並有 cell cap。匯出仍是每筆取樣一列的 `Time,GPS_Lat,GPS_Lon,GPS_Speed,...`。 |

> 對稱性現況：匯入側六個格式（loga / nmea / vbo 文字 + rcz / xrk / rcnx 二進位，其中 rcnx 用 sql.js WASM）都已 registry 化、走同一條 worker 路徑；
> 匯出側**已 registry 化**（`src/domain/export/registry.ts` 的 `EXPORT_FORMATS`：`nmea` / `vbo` / `csv`），`converterStore.convertAll()` 用單一迴圈透過 `ExportFormat.exportSession()` 驅動；§7 記錄的「三個匯出器各有不同呼叫慣例」是 registry 化**之前**的歷史現況，予以保留作紀錄，但目前已由 registry 統一封裝。

---

## 5. 如何新增一個「文字格式」importer（以 VboImporter 為範例）

以 `vbo` 為樣板，步驟如下：

1. **寫純解析函式 `parseXxx(text): LogSession`**
   放在 `src/domain/import/xxx/parseXxx.ts`。職責：把整份文字切成欄、組出 `Channel[]`
   （資料用 `Float32Array`，無值填 `NaN`，名稱用 `canonicalName` / `descriptionOf` 正規化），
   並組出 `LogMeta`（`formatId: 'xxx'`、`createdDate`、`headerInfo`），回傳 `new LogSession(channels, meta)`。
   參考 `parseVbo.ts`：它示範了區段切割、座標換算、UTC 時間欄拆解與「剩餘欄變遙測 channel」。
   **務必只依賴 worker-safe 的程式碼**（不可碰 DOM / window），因為它會在 worker 內執行。

2. **包成 `Importer`**
   `src/domain/import/xxx/XxxImporter.ts`：
   ```ts
   export const xxxImporter: Importer = {
     id: 'xxx',
     extensions: ['xxx'],
     detect: ({ fileName, headText }) =>
       fileName.endsWith('.xxx') || /<內容特徵>/.test(headText),
     parse: (text) => parseXxx(text),
   }
   ```

3. **註冊進 `IMPORTERS`**（`registry.ts`）
   把 `xxxImporter` 加入陣列。**注意排序**：若副檔名泛用（如 `.csv`），務必排在更泛用者之前，
   並讓 `detect` 以 `headText` 內容嗅探取勝（§3 的 first-match-wins）。

4. **註冊進 worker 的 `WORKER_PARSERS`**（`parse.worker.ts`）
   ```ts
   const WORKER_PARSERS = {
     loga: (text, onProgress) => parseLoga(text, onProgress),
     nmea: (text) => nmeaToSession(text),
     vbo:  (text) => parseVbo(text),
     xxx:  (text) => parseXxx(text),   // ← 新增，鍵必須等於 importer.id
   }
   ```
   鍵是 `importerId`，主執行緒在 `parseFile(file, imp.id)` 帶過來。**沒有對應的 worker 條目，
   匯入會在 worker 端以 `No worker parser for importer 'xxx'` 失敗**。

5. **加偵測 / 自動流通副檔名**
   `detect` 寫好後，`allImportExtensions()` 會自動把新副檔名納入 `<input accept>` 與 zip 白名單，
   **不需手動改 `FileBar.vue` 或 `zip.ts`**。

6. **寫測試**
   - **fixture 測試**：放一份小型樣本，斷言 channel 名、`rowCount`、`formatId` 與關鍵數值。
   - **round-trip 測試**（若同時有對應 exporter）：匯出 → 重新匯入，斷言座標 / 數值還原（`parseVbo`
     刻意鏡像了 `convertToVbo` 的座標反轉，就是為了 round-trip 對拍）。

---

## 6. 二進位與 ZIP 格式的擴充（已落地）

`Importer.parse` 原本**只吃 `text`**，`detect` 只拿得到 `headText`（前 4 KB 解成 UTF-8）——
這對純文字格式夠用，但二進位格式（XRK）與 ZIP 容器（RCZ / RCNX）需要兩個擴充，**現已實作並在用**：

- **`detect` 端：`ImportCandidate` 補上 `headBytes: Uint8Array`**——二進位 magic（例如 ZIP 的
  `PK\x03\x04`、zlib 的 `0x78`）在解成文字時會被破壞，必須比對原始 bytes。
- **`parse` 端：新增 `parseBinary(bytes: Uint8Array, onProgress?)`**（見 `Importer.ts`）——worker /
  registry 在 importer 提供 `parseBinary` 時改傳 `Uint8Array` 而非文字。

三個二進位 importer（`xrkImporter` / `rczImporter` / `rcnxImporter`，見 §4 支援矩陣）都已用這條路徑
接入；`rcnxImporter` 另外動態載入 `sql.js`（WASM）解 SQLite。XRK / RCZ / Qstarz 的格式層評估（是否
二進位、是否有開源 parser、瀏覽器可行性、formatId 命名建議、接入方式）詳列於
[`FORMAT-SUPPORT-RESEARCH.md`](./specs/FORMAT-SUPPORT-RESEARCH.md)，此處不重複。

**原則：等第一個二進位 importer 真的要實作時，才一併加入 `headBytes` 與 `parseBinary`**，
避免在沒有消費者的情況下預先污染介面（介面保持「現在被用到」的最小面積）。

---

## 7. Exporter 側：registry 化現況

匯入側 registry 化的模式（§3）現已在匯出側對稱套用。以下記錄目前的介面與 registry 設計，
以及仍未納入的例外（`.loga` 就地 patch）。

### 7.1 `ExportFormat` 介面與 registry（`src/domain/export/registry.ts`）

```ts
interface ExportArtifact {
  readonly suffix: string   // 檔名後綴，例如 '' 或 '_ct'
  readonly ext: string      // 副檔名（不含點），例如 'nmea' / 'vbo' / 'csv'
  readonly content: string
}

interface ExportOptions {
  readonly mapping?: Rc3Mapping   // 僅 NMEA/RC3 格式使用
  readonly now?: Date
}

interface ExportFormat {
  readonly id: string               // 穩定 id，例如 'nmea' / 'vbo' / 'csv'
  readonly fileExtension: string
  exportSession(session: LogSession, sourceName: string, options?: ExportOptions): ExportArtifact[]
}

const EXPORT_FORMATS: readonly ExportFormat[] = [nmeaFormat, vboFormat, csvFormat]
function getExportFormat(id: string): ExportFormat | undefined
```

- **回傳值統一為 `ExportArtifact[]`**（不是單一字串），涵蓋 NMEA 的單檔輸出、VBO 的三檔輸出
  （`_ct.vbo` / `_rc.vbo` / `_channels.csv`）與 CSV 的單檔輸出，同一介面表達「一或多個產物」。
- **`ExportOptions.mapping`** 是唯一的格式特定參數（僅 NMEA/RC3 消費），其餘格式忽略。
- 底層各自的具體實作各有慣例（`Rc3NmeaExporter implements Exporter` 但 `export()` 多吃
  `mapping`；`convertToVbo` / `convertToCsv` 是回傳 `Artifact[]` 的 free function），`registry.ts`
  裡的三個 `ExportFormat` 物件負責把它們**收斂成統一的 `exportSession()` 簽章**。
- `converterStore.convertAll()`（`src/stores/converterStore.ts`）用**單一迴圈**透過
  `getExportFormat(outputFormat.value)` 取得格式物件並呼叫 `exportSession()`，不再有逐格式分支。
- `test/export/registry.test.ts` 對每個格式都斷言「registry 呼叫」與「直接呼叫底層函式」逐位元組
  相同——registry 是一層封裝，不改變任何輸出位元。

### 7.2 UI 端：新增格式需要同步的地方

`EXPORT_FORMATS` 是格式的單一真實來源，但轉檔器 UI 目前**沒有**完全自動流通新格式（不像匯入側的
`allImportExtensions()`）。新增一個匯出格式時，除了 `registry.ts` 本身，還需要手動同步：

- `src/stores/converterStore.ts`：`OutputFormat` 字面聯合型別要加上新 id（刻意維持字面聯合而非
  `ExportFormat['id']`，讓 persisted localStorage 值仍受型別檢查）。
- `src/features/converter/ConvertResults.vue`：`FORMATS` 陣列（格式選擇器的 radiogroup 選項）。
- `src/features/converter/ConverterNotes.vue` / `ConverterView.vue`：格式專屬的說明文字或面板
  （例如 VBO 顯示 `VboChannelMap` 通道對照表；CSV 沒有專屬面板，只有說明文字）。
- `src/i18n/locales/{en,zh-Hant}.ts`：`converter.format.hint.<id>` 與 `converter.notes.<id>`。

### 7.3 仍在 registry 之外：`.loga` 就地 patch

**`.loga` 匯出**走的是 `patchLogaText(text, replacements)`（`LogaWriter.ts`，就地 patch 原始
`.loga` 文字：既有欄覆寫、缺欄附加、其餘逐字保留），**刻意不納入** `ExportFormat` registry——
它的語意是「patch 原始來源檔」，只對 `.loga` 來源成立，跟「從任意 `LogSession` 產生一個新格式」的
`ExportFormat` 語意不同（見 `registry.ts` 檔頭註解）。呼叫路徑仍是 `converterStore` 之外的獨立
「另存校正後的 .loga」流程。

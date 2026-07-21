# 格式支援研究：AiM XRK / RaceChrono RCZ / Qstarz LT-8000GT

> 狀態：**三格式皆已實作並落地**（本文件為 2026-06-24 的實作前研究，保留為決策脈絡）。
> `.xrk`/`.xrz`（`parseXrk`）、`.rcz`（`parseRcz`）、Qstarz `.rcnx`（`parseRcnx`，實測機種為
> LT-Q6000/Q6000S，非本文原標的 LT-8000GT）皆以真檔驗證；規格見
> [`XRK-FORMAT-SPEC.md`](./XRK-FORMAT-SPEC.md) / [`RCNX-FORMAT-SPEC.md`](./RCNX-FORMAT-SPEC.md)，
> 當前進度見 [`../IMPORT-FORMATS-STATUS.md`](../IMPORT-FORMATS-STATUS.md)。
> 撰寫日期：2026-06-24 · 對應分支：`docs/format-research`

## 目的

使用者希望 Track Log Studio 未來能匯入／匯出並分析三種賽車資料記錄器格式：

1. **AiM XRK**（`.xrk` / `.xrz`）— AiM Sports / RaceStudio 資料記錄器（SmartyCam、MyChron、Solo 2 DL、MXG/MXP、EVO5 等）。
2. **RaceChrono RCZ**（`.rcz`）— RaceChrono 手機 App 的 session 匯出。
3. **Qstarz LT-8000GT** — Qstarz GPS 圈速計 / 資料記錄器（搭配 QRacing 軟體）。

本文件**只做研究與架構接入評估**，不撰寫 parser（研究當下尚無樣本檔）。每節都附上來源 URL，並誠實標注無法驗證之處。

---

## 現有架構摘要（接入前提）

本專案是純前端瀏覽器 PWA（Vue 3 + TS），所有解析都在瀏覽器內完成，**沒有後端、不能呼叫原生 DLL**。

- **Importer 介面**（`src/domain/import/Importer.ts`）：
  ```ts
  interface Importer {
    readonly id: string
    readonly extensions: readonly string[]
    detect(candidate: ImportCandidate): boolean        // 看 fileName + headText 前 4KB
    parse(text: string, onProgress?): LogSession | Promise<LogSession>
  }
  ```
  - `ImportCandidate = { fileName, headText }`，`headText` 是檔案前 4096 bytes 解成文字（`registry.ts` 的 `sniff()`）。
  - 註冊在 `src/domain/import/registry.ts` 的 `IMPORTERS` 陣列，**第一個 `detect()` 回 true 的勝出**。目前有 `loga`、`nmea`、`vbo`。
- **Exporter 介面**（`src/domain/export/Exporter.ts`）與之對稱。
- **內部模型**：
  - `LogSession` = `Channel[]` + `LogMeta`。
  - `Channel = { name, rawName, description, data: Float32Array }`。
  - `LogMeta = { formatId: string, createdDate, headerInfo }`。
- **解析在 Web Worker 內跑**（大檔約 54 MB），`parse` 必須 async-capable 並回報進度 `[0,1]`。
- **ZIP 已就緒**：`src/domain/import/zip.ts` 用 `fflate` 的 `unzipSync`，已內建防護（zip bomb 上限 512 MB、zip-slip 路徑壓平、副檔名 allowlist 只解 registry 已知副檔名）。
- **目前限制**：`Importer.parse` 只吃 **TEXT**。二進位格式需要未來新增介面擴充，建議：
  ```ts
  // 提案
  parseBinary?(bytes: Uint8Array, onProgress?): LogSession | Promise<LogSession>
  ```
  並讓 worker / registry 在 `detect` 命中且 importer 提供 `parseBinary` 時，改傳 `Uint8Array` 而非 text。`detect` 也需要能看到原始 bytes（目前 `headText` 對二進位 magic bytes 不可靠——見下方各節）。

> **接入時的共通注意**：`detect()` 目前只拿得到 `headText`（前 4KB 解碼成 UTF-8 文字）。二進位格式（XRK）或 ZIP 容器（RCZ）的前綴不是有效文字，magic bytes 可能在解碼時被破壞。要乾淨支援，`ImportCandidate` 應補上 `headBytes: Uint8Array`，讓 `detect` 能比對二進位簽章（例如 ZIP 的 `PK\x03\x04`）。

---

## 1. AiM XRK（`.xrk` / `.xrz`）

### 格式家族與副檔名

- **`.xrk`** — AiM 較新世代記錄器（RaceStudio 3 生態：MXG/MXP/MXL2/EVO5/MyChron5、Solo 2 DL 等）的**原生二進位記錄檔**，含全精度原始資料、區段（sections）與 footer 中的 metadata（車輛、賽道、日期等）。
- **`.xrz`** — **就是壓縮過的 `.xrk`**（'z' = zipped）。「一個 XRZ 內含一個 XRK」，為加速傳輸而壓縮。libxrk 的說明也證實 XRZ 是 zlib 壓縮的 XRK。
- **`.drk`** — **舊的 RaceStudio 2 格式**，資料容量與資訊量都比 `.xrk` 少；屬於前一世代。
- 因此家族關係：`drk`（RS2，舊）→ `xrk`（RS3，新，二進位）→ `xrz`（xrk 的壓縮包裝）。

來源：
- AiM 官方 file types 簡報 PDF：<https://www.aimsports.com/webinars/Documents/AiM_FileTypes.pdf>
- Brake Point 匯入指南（XRK/XRZ 關係）：<https://www.brakepoint.io/en/guides/aim-xrk/>
- MyRaceLab AiM 裝置支援：<https://myracelab.com/device-support/aim/>
- OpenECU Alliance「AiM XRK/DRK Binary Adapter」：<https://www.openecualliance.org/adapters/aim/aim-xrk>

### 二進位或文字

**二進位。** XRK 是分區段、footer 帶 metadata 的二進位記錄檔，無法當文字解析。

### 公開規格 / SDK / 開源 parser

**沒有公開的官方二進位規格文件**，但有以下兩條路：

**(A) AiM 官方 DLL（Windows，原生）**
- AiM 提供 32-bit 與 64-bit DLL 來開 `.xrz/.xrk`（並 beta 支援 `.drk`）。所有函式記在隨附的 **`MatLabXRK.h`** 標頭中，並附 Visual Studio 2022 範例（`TestMatLabXRK.sln`）與 MATLAB 範例（`XrkAccessExample.m`）。
- 可讀取：metadata（車輛、車手、championship、venue、賽道、日期、各圈圈速秒數）、session/lap 時間基準、各 channel（依裝置設定而異）、GPS 原始 channel（ECEF 位置/速度、衛星數）與計算後 GPS channel（速度、航向、高度、精度、加速度衍生量）。
- 文件未明列授權條款。**重點：這是原生 Windows DLL，瀏覽器無法直接呼叫。**
- 來源：<https://www.aim-sportline.com/docs/racestudio3/html/xrk-dll.html>

**(B) 開源 parser（關鍵發現）**
- **`racer-coder/TrackDataAnalysis`**（Scott Smith，**MIT**，Python + Cython）— 跨平台 GUI，**原生開啟 AiM XRK**（不靠 AiM DLL），其 XRK 解析是**直接 reverse-engineer 二進位格式**。這是最有價值的參考實作。
  <https://github.com/racer-coder/TrackDataAnalysis>
- **`libxrk`**（PyPI，**MIT**）— **純 Cython 的 XRK 解析器，不依賴 AiM DLL**，「incorporates code from TrackDataAnalysis by Scott Smith」。可讀 XRK 與 XRZ（zlib 壓縮），提供 channel/lap metadata、GPS 座標轉換、lap detection、時間範圍/圈過濾、resampling。**官方說明明確指出已在 Pyodide / WebAssembly 環境測試（Pyodide 0.27.x / 0.29.x）**。這是「瀏覽器端可行」的最強證據。
  - <https://pypi.org/project/libxrk/> ／ <https://libraries.io/pypi/libxrk>
- **`bmc-labs/xdrk`**（Rust，crate）— **是 AiM 原生 C/C++ 共享庫的 wrapper**，repo 內含 AiM 的 `.dll`/`.lib`，僅支援 Linux/Windows 64-bit。**因為綁原生庫，不適合瀏覽器**（除非 AiM 庫本身能編成 WASM，未知）。
  - <https://github.com/bmc-labs/xdrk> ／ <https://lib.rs/crates/xdrk>
- **`laz-/xrk`**（Python，**BSD-3**，已封存）— 早期 wrapper，**用 AiM 官方 DLL**；作者自己建議改用 libxrk + Inferno Analyzer。僅供參考。
  - <https://github.com/laz-/xrk>
- 相關：**`ludovicb1239/Aim_2_MoTeC`**（C#）把 AiM 資料轉成 MoTeC i2 Pro，含對 MoTeC `.ld` 的逆向；**`gotzl/ldparser`**（Python）純逆向解析 MoTeC `.ld`。若日後要做 XRK→MoTeC 互轉可參考。
  - <https://github.com/ludovicb1239/Aim_2_MoTeC> ／ <https://github.com/gotzl/ldparser>

### 瀏覽器端可行性：**中**

- **正面**：`TrackDataAnalysis` / `libxrk` 證明 XRK 二進位可被**純逆向**解析、不需 AiM 原生 DLL，且 libxrk 已在 **Pyodide/WASM** 跑過——表示在瀏覽器端技術上可行。
- **負面 / 成本**：
  - 二進位逆向格式，沒有官方規格，實作量大、邊界情況多（不同裝置 channel 配置差異）。
  - 直接走 Pyodide 會引入很重的 Python runtime（數 MB），與本專案輕量 TS 風格不合；較理想是把 libxrk/TrackDataAnalysis 的解析邏輯**移植成 TypeScript**，或將其 C/Cython 核心**編成獨立 WASM module**。
  - XRZ 需先 zlib 解壓（`fflate` 已能做 `unzlibSync`，可重用）。
- **結論**：可行但屬中等工作量，且高度依賴有真實樣本檔可對拍。

### 若要實作所需前置

1. **數個真實 `.xrk` 與 `.xrz` 樣本檔**（最好涵蓋不同裝置：MyChron5、MXx、Solo 2 DL），含已知圈速以便驗證。
2. 決定技術路線：**(a)** 將 `libxrk`/`TrackDataAnalysis` 的格式邏輯移植成 TS；或 **(b)** 把其核心編成 WASM。建議先讀 `TrackDataAnalysis` 的 `aim/xrk.py`（MIT）作為格式真相來源。
3. 釐清授權：移植 MIT 程式碼需保留授權聲明（沒問題）。**不要**散布 AiM 官方 DLL（授權不明、且原生庫對瀏覽器無用）。

### 如何接進現有 Importer 架構

- **需要 `parseBinary` 擴充**（XRK 是二進位）。
- **detect**：
  - 副檔名 `xrk` / `xrz`。
  - `xrz` 是 zlib 包裝：先嗅 zlib magic（`0x78` 開頭）或直接靠副檔名；解壓後再驗 XRK 內部簽章。
  - 由於目前 `detect` 只有 `headText`，需先補 `headBytes: Uint8Array` 才能可靠比對 XRK 的二進位簽章。
- **流程**：`xrz` →（`fflate` unzlib）→ `xrk` bytes → `parseBinary(bytes)` → `LogSession`。
- **formatId 命名建議**：`aim-xrk`（importer `id: 'aim-xrk'`, `extensions: ['xrk', 'xrz']`）。內部以 `LogMeta.formatId = 'aim-xrk'` 標示；若日後支援 `drk` 再開 `aim-drk`。

---

## 2. RaceChrono RCZ（`.rcz`）

### 格式家族與副檔名

- **`.rcz`** — RaceChrono App 的 **session 內部匯出格式**。社群驗證：**把 `.rcz` 改名成 `.zip` 可以解開**，裡面是 RaceChrono 自己的資料（社群回報含 JSON；亦有人提到可手動編輯內部以加 CAN database）。**是 ZIP 容器。**
- RaceChrono 開發者明言：**RCZ 是內部格式、不公開**，因為他們持續在加/改欄位，且其他軟體基本不支援。
- RaceChrono 另可匯出多種**有文件、通用**的格式：**CSV（v3）**、**`.vbo`（RaceLogic Circuit Tools）**、**`.nmea`**、**GPX/KML**、**ODS**。它也能讀 `.vbo`/`.nmea` 等。

來源：
- RaceChrono 論壇「Rcz-format」討論串（RCZ 內部、不公開；改名 zip 可解）：<https://racechrono.com/forum/discussion/1522/rcz-format>（論壇對自動抓取回 404，內容由搜尋摘要與其他頁交叉佐證）
- 「Extract rcz file」討論：<https://racechrono.com/forum/discussion/1472/extract-rcz-file>
- 「Manual editing of rcz to add CAN database」：<https://racechrono.com/forum/d/2453-2453>
- MyRaceLab RaceChrono 支援（**需選 CSV v3**）：<https://myracelab.com/device-support/racechrono/>
- RaceDAC 從 RaceChrono 匯出資料：<http://www.racedac.com/dataexporting.html>

### 二進位或文字

- **`.rcz` 本體 = ZIP 容器**（二進位封裝）；**內部主要是文字（JSON / CSV-like）**，依社群回報。**確切內部 schema 未公開、需樣本驗證。**
- RaceChrono 的 **CSV v3** 與 **VBO/NMEA** 都是純文字、且本專案已能處理 NMEA/VBO/CSV-like。

### 公開規格 / SDK / 開源 parser

- **RCZ 內部 schema：無官方文件**（開發者明言內部、會變動）。
- **RaceChrono CSV v3**：是被第三方（MyRaceLab、RaceRender、Autosport Labs 等）廣泛支援的匯出格式，**header 以固定 channel 識別字為欄名、資料列接在下方**。但**逐欄精確規格未在官方公開文件中列出**，需樣本確認實際欄位（典型應含 time/distance、latitude/longitude、speed、lateral/longitudinal acceleration、lap index 等，但**此處未經樣本驗證，標為待確認**）。
  - 參考：RaceChrono 論壇 CSV 討論 <https://racechrono.com/forum/discussion/179/exporting-csv>、Autosport Labs 論壇 <https://forum.autosportlabs.com/viewtopic.php?t=3781>
- **VBO**：RaceLogic 格式，本專案**已有 `vboImporter`**。
- **NMEA**：本專案**已有 `nmeaImporter`**。

### 瀏覽器端可行性：**高**（三者中最可行）

理由：
- `.rcz` 是 ZIP，**本專案已有 `zip.ts`（fflate）能安全解壓**。
- 解開後內部若是 **CSV（RaceChrono CSV v3）** 或可轉成既有 importer 吃得下的文字，**大部分基礎設施已具備**。
- 退一步：即便不直接吃 `.rcz` 內部，**請使用者在 RaceChrono 內匯出 CSV v3 / VBO / NMEA**，VBO/NMEA 兩條路**今天就能用既有 importer 直接匯入**；CSV v3 只需新增一個 CSV importer。

**風險 / 不確定**：RCZ 內部 schema 未公開且會變動——直接解析 RCZ 內部是「追著移動標靶跑」。因此**建議優先支援 RaceChrono 的標準匯出（CSV v3 / VBO / NMEA），而非 RCZ 內部**。

### 若要實作所需前置

1. **走 RCZ 內部路線**：需要數個 `.rcz` 樣本，解壓後檢視內部檔名與 JSON/CSV schema。
2. **走標準匯出路線（建議）**：需要一個 **RaceChrono CSV v3 樣本**以鎖定欄位對應；VBO/NMEA 可先用既有 importer 試拍既有樣本即可。

### 如何接進現有 Importer 架構

- **路線一（建議，CSV v3）**：新增 `racechrono-csv` importer。
  - `detect`：副檔名 `csv` + 用 `headText` 嗅 RaceChrono CSV v3 的標頭特徵（metadata 行 / 固定 channel 名）。因為 `.csv` 太泛用，**務必靠 headText 內容判斷**，且註冊順序要讓它在通用 CSV 之前。
  - `parse(text)`：純文字，沿用現有 CSV/通道解析模式產生 `LogSession`。
  - `formatId`：`racechrono-csv`。
- **路線二（RCZ 容器）**：
  - 因 `.rcz` 是 ZIP，先把 `rcz` 加進 `zip.ts` 的副檔名 allowlist 流程，**unzip → 找內部 CSV/JSON → 委派給內部 importer 解析**。
  - `detect`：副檔名 `rcz`，或用 `headBytes` 比對 ZIP magic `PK\x03\x04`（同樣需要前述 `headBytes` 擴充）。
  - 內部若是 JSON 則需新寫 JSON→`LogSession` 對映（schema 未公開，風險高）。
  - `formatId`：`racechrono-rcz`。
- **VBO / NMEA**：**無需新 importer**，沿用既有 `vbo` / `nmea`。

---

## 3. Qstarz LT-8000GT（QRacing）

### 格式家族與副檔名

- LT-8000GT 是 **25Hz GNSS GPS 圈速計 / 資料記錄器**，搭配 **QRacing** 軟體（手機 App + PC + Web）做圈速與 sector 分析。
- **官方生態以 QRacing 專屬格式為主**；官方 features 頁**沒有列出任何開放匯出格式**（只談 QRacing App / PC / Web 同步分析）。
- **QRacing 支援匯出 CSV**（多處提及），但**官方未公開逐欄 CSV schema**。
- **重要的替代路徑**：LT-8000GT 是 **RaceChrono 支援的外接 GPS**，透過 RaceChrono 即可匯出 **NMEA / VBO / CSV / GPX / KML / ODS**——這等於把 Qstarz 資料導向「第 2 節」已可行的格式。

來源：
- Qstarz LT-8000GT 官網：<https://qws.qstarz.com/Official/8000gt/> ／ features：<https://qws.qstarz.com/Official/8000gt/features.php>
- QRacing 使用手冊（PDF，**抓取到的是影像式內容，無法擷取欄位文字**）：<https://qstarz.s3.amazonaws.com/public/QRacing/documents/UsersManual_EN.pdf>
- QRacing 產品頁：<https://racing.qstarz.com/Products/Qracing.html>
- RaceChrono 支援 Qstarz 作為外接 GPS、可匯出 NMEA/VBO/CSV/GPX/KML/ODS：<https://racechrono.com/support>、GPX 匯出討論 <https://racechrono.com/forum/discussion/970/export-to-gpx>

### 二進位或文字

- **QRacing 原生 session 格式**：**未確認**（官方未公開副檔名/結構；可能為專屬二進位或資料庫）。
- **QRacing CSV 匯出**：**文字**（逐欄 schema 待樣本確認）。
- **經 RaceChrono 匯出的 NMEA / VBO / CSV**：文字，且本專案已能處理 NMEA/VBO。

### 公開規格 / SDK / 開源 parser

- **無公開規格、無已知開源 parser**（針對 QRacing 原生格式）。
- QRacing **CSV 匯出**有被提及，但**逐欄欄位（Time / Latitude / Longitude / Speed / 加速度 / lap 等）未能由官方來源逐一驗證**——搜尋與手冊都未明列；**標為待樣本確認**。

### 瀏覽器端可行性

- **經 RaceChrono / VBO / NMEA 路線：高**（本專案 `vbo` / `nmea` importer 直接可用）。
- **直接吃 QRacing 原生 session 格式：低**（格式未知、無規格、無開源 parser）。
- **QRacing CSV：中**（是文字，但需樣本鎖定欄位，且需確認是否帶多段 metadata 標頭）。

### 若要實作所需前置

1. 取得**真實樣本**：
   - 一份 **QRacing CSV 匯出**（鎖定欄位對應）；
   - 若要走原生格式，需 QRacing 的原生 session 檔（並逆向，成本高、不建議）。
2. 取得一份**經 RaceChrono 由 LT-8000GT 匯出的 NMEA 或 VBO**，可立即用既有 importer 試拍驗證。

### 如何接進現有 Importer 架構

- **首選：不寫新 parser**——引導使用者用 **RaceChrono 匯出 VBO/NMEA**，直接走既有 `vbo` / `nmea` importer。
- **若支援 QRacing CSV**：新增 `qstarz-csv` importer，
  - `detect`：副檔名 `csv` + 以 `headText` 嗅 QRacing 專屬標頭（避免與其他 CSV 衝突；註冊順序需安排）。
  - `parse(text)`：純文字解析成 `LogSession`。
  - `formatId`：`qstarz-csv`。
- **QRacing 原生格式**：在取得樣本並確認結構前**不建議實作**。

---

## 可行性與優先順序總表

| 格式 | 副檔名 | 二進位? | 容器/壓縮 | 有開源 parser? | 瀏覽器可行性 | 建議下一步 |
|---|---|---|---|---|---|---|
| RaceChrono（VBO / NMEA 路線） | `.vbo` / `.nmea` | 否（文字） | 否 | 不需要（本專案已有） | **高** | 今天就能用既有 `vbo`/`nmea` importer 試拍 |
| RaceChrono CSV v3 | `.csv` | 否（文字） | 否 | 第三方廣泛支援；逐欄需樣本 | **高** | 取得 1 份 CSV v3 樣本 → 新增 `racechrono-csv` |
| RaceChrono RCZ（內部） | `.rcz` | ZIP 容器，內部多為文字(JSON/CSV) | 是（ZIP，`zip.ts` 可解） | 無（內部 schema 不公開、會變動） | 中（內部 schema 風險） | 取得 `.rcz` 樣本解壓檢視；但**優先走標準匯出** |
| Qstarz（經 RaceChrono VBO/NMEA） | `.vbo` / `.nmea` | 否（文字） | 否 | 不需要 | **高** | 引導用 RaceChrono 匯出，沿用既有 importer |
| Qstarz QRacing CSV | `.csv` | 否（文字） | 否 | 無 | 中（需樣本鎖欄位） | 取得 QRacing CSV 樣本 → 新增 `qstarz-csv` |
| AiM XRK / XRZ | `.xrk` / `.xrz` | **是（二進位）** | XRZ=zlib 壓縮 | **有**（TrackDataAnalysis / libxrk，MIT，純逆向，已在 Pyodide/WASM 測過） | **中** | 取得樣本 → 移植 libxrk/TDA 邏輯成 TS 或編 WASM；需 `parseBinary` 擴充 |
| Qstarz QRacing 原生 session | 未知 | 未確認 | 未知 | 無 | **低** | 暫不實作（無規格/無樣本/無 parser） |

---

## 建議的實作順序

1. **RaceChrono / Qstarz 的 VBO + NMEA 路線（最快、零新解析）**
   既有 `vbo` / `nmea` importer 已覆蓋。只要文件化「請從 RaceChrono 匯出 VBO 或 NMEA」即可同時服務 RaceChrono 與 Qstarz LT-8000GT 使用者。
   **動工條件**：拿到 1 份 RaceChrono/Qstarz 匯出的 `.vbo` 或 `.nmea` 樣本來驗證既有 importer 對得上。

2. **RaceChrono CSV v3 importer（`racechrono-csv`）**
   純文字、基礎設施齊全；只需鎖定欄位對應與標頭嗅探。
   **動工條件**：1 份 RaceChrono **CSV v3** 匯出樣本（用來確認 metadata 行、channel 欄名、單位列、取樣率）。

3. **Qstarz QRacing CSV importer（`qstarz-csv`）**（若使用者偏好直接用 QRacing 而非 RaceChrono）
   **動工條件**：1 份 QRacing **CSV 匯出**樣本（確認欄名、是否多段 metadata 標頭、是否含 lap/sector 欄位）。

4. **AiM XRK / XRZ importer（`aim-xrk`，需 `parseBinary` 擴充）**
   工作量最大但有 MIT 逆向參考（TrackDataAnalysis / libxrk）。先完成介面擴充（`parseBinary` + `ImportCandidate.headBytes`），再移植格式邏輯或編 WASM；XRZ 先用 `fflate` unzlib。
   **動工條件**：
   - 介面：先合入 `parseBinary` 與 `headBytes` 擴充；
   - 樣本：數個 `.xrk` 與 `.xrz`（涵蓋不同裝置，含已知圈速以對拍）；
   - 決策：移植 TS vs 編 WASM。

5. **RaceChrono RCZ 內部解析（`racechrono-rcz`）— 最後，視需求**
   只有在使用者堅持直接吃 `.rcz`（而非請他們匯出標準格式）時才做；內部 schema 不公開且會變動，維護風險高。
   **動工條件**：數個 `.rcz` 樣本（解壓後檢視內部檔名與 JSON/CSV schema），且接受其格式可能隨 RaceChrono 版本變動。

6. **Qstarz QRacing 原生 session 格式 — 暫不排程**
   無公開規格、無樣本、無開源 parser。除非取得規格或樣本，否則維持「請改用 RaceChrono 匯出」的替代方案。

---

## 誠實標注的不確定處

- **無任何樣本檔**：本研究全憑公開文件與開源 repo，所有「欄位 / schema」層級的細節（RaceChrono CSV v3 逐欄、QRacing CSV 逐欄、RCZ 內部檔案結構、XRK 二進位 byte 佈局）**都需真實樣本才能定稿**。
- **RaceChrono 論壇對自動抓取回 404**：RCZ「是 ZIP、內部 JSON、官方不公開」等結論來自搜尋摘要與多個第三方頁交叉佐證，**未能逐字讀取原始論壇貼文**。
- **RaceChrono CSV v3 逐欄欄位未由官方逐一驗證**：僅知「header 為固定 channel 識別字、資料列在下」，典型欄位（lat/lon/speed/accel/lap）為合理推測，**標為待樣本確認**。
- **QRacing 原生 session 格式未知**：官方 features 頁未列開放匯出；CSV 匯出存在但 schema 未公開。手冊 PDF 為影像式內容，無法擷取欄位文字。
- **AiM 沒有公開的二進位規格**：可行性「中」是建立在 `TrackDataAnalysis`/`libxrk`（MIT，純逆向，已在 Pyodide 測過）之上；**尚未實際讀完其格式邏輯或驗證不同裝置的 channel 差異**。
- **AiM 官方 DLL 授權條款未明列**，且無論如何不適用於瀏覽器；`bmc-labs/xdrk` 因綁原生庫亦不適用瀏覽器。

---

## 主要來源彙整

AiM XRK：
- <https://www.aim-sportline.com/docs/racestudio3/html/xrk-dll.html>
- <https://www.aimsports.com/webinars/Documents/AiM_FileTypes.pdf>
- <https://www.brakepoint.io/en/guides/aim-xrk/>
- <https://myracelab.com/device-support/aim/>
- <https://github.com/racer-coder/TrackDataAnalysis>（MIT，純逆向 XRK parser）
- <https://pypi.org/project/libxrk/> ／ <https://libraries.io/pypi/libxrk>（MIT，Cython，Pyodide/WASM 測過）
- <https://github.com/bmc-labs/xdrk>（Rust，wrap AiM 原生庫）
- <https://github.com/laz-/xrk>（BSD-3，已封存，用官方 DLL）
- <https://github.com/ludovicb1239/Aim_2_MoTeC> ／ <https://github.com/gotzl/ldparser>（MoTeC 互轉參考）

RaceChrono RCZ：
- <https://racechrono.com/forum/discussion/1522/rcz-format>
- <https://racechrono.com/forum/discussion/1472/extract-rcz-file>
- <https://racechrono.com/forum/d/2453-2453>
- <https://myracelab.com/device-support/racechrono/>
- <https://racechrono.com/forum/discussion/179/exporting-csv>
- <http://www.racedac.com/dataexporting.html>

Qstarz LT-8000GT：
- <https://qws.qstarz.com/Official/8000gt/> ／ <https://qws.qstarz.com/Official/8000gt/features.php>
- <https://racing.qstarz.com/Products/Qracing.html>
- <https://qstarz.s3.amazonaws.com/public/QRacing/documents/UsersManual_EN.pdf>
- <https://racechrono.com/support> ／ <https://racechrono.com/forum/discussion/970/export-to-gpx>

---

## 附錄：真檔探查發現（取得樣本後更新）

先前的研究在**無樣本**下完成；真實樣本檔放入 `LogaExample/` 後
（`b1(5).loga`、`b1(5)_ct.vbo`、`b1(5)_rc.vbo`、`session_20260622_0025_b1(5)_rcvbo.rcz`、
`142.rcnx`，以及四個 AiM `*.xrk`），實際探查（解 zip / 看 magic / dump 結構），
**三種格式的可行性都比先前的純文獻評估更明朗**，以下為實測結論。

### VBO 真檔驗證（先前的 VboImporter）— ✅ 通過
- `b1(5)_ct.vbo`：17791 列、150 channels、**GPS_Lat 23.103 / GPS_Lon 120.222**（台南 A.R.K.，
  東經正值，符號正確）；ECU channel 名完整保留（RPM/AFR/TPS_Percent…）。解析 8MB ~150ms。
- `b1(5)_rc.vbo`：同 17791 列，channel 名為 RaceChrono 的 `rc_*`（rc_rpm/rc_analog_1…，與先前研究一致）。
- 結論：先前的 `parseVbo` 對真實大檔正確可用，非僅合成 fixture。

### RCNX（Qstarz Q6000／6000S，QRacing 出軌機）— 可行性「**高**」（大幅上修）
- 實測：`142.rcnx` 是 **ZIP 容器**，內含每個 session 三檔：
  `sess_N.db`（**"SQLite format 3" 標準 SQLite 資料庫**）、`sana_N.db`（SQLite，分析快取）、
  `summary_N.txt`（純文字摘要，512B）。本檔有多個 session（sess_0/1/2…）。
- 這是最大驚喜：**資料就在標準 SQLite 表裡**，不是私有二進位。
- 接入路線：fflate 解 zip（已有）→ 用 SQLite 讀 `sess_N.db`。瀏覽器端讀 SQLite 需
  **`sql.js`（SQLite 編譯成 WASM，MIT）** 或 `wa-sqlite`。這是新增依賴的架構決策。
- 待辦：拿到 db 後需 `PRAGMA table_info` / dump schema 找出座標/速度/時間/通道表結構（需實際開 db）。

### RCZ（RaceChrono session 匯出）— 可行性「**中高**」（上修）
- 實測：ZIP 容器，內含 `session.json`、`trackId.json`、`sessionfragment.json`
  ＋大量 `channel_*` / `channel2_*` 二進位檔（每通道一檔）。
- `session.json` metadata 豐富：`firstPositionLatitude:138623850`（= 分×1e5，÷1e5/60 ≈ 23.10°）、
  **`laps[]`（每圈 start/finish timestamp + `isInvalid`）**、`bestLaptime`/`optimalLaptime`/`lapCount`/
  `trackName:"A.R.K."`。
- channel 檔 = **raw 數值陣列**（無壓縮）：`channel2_*_3` 大小 142328 = 17791×8 → float64；
  `channel_*_0` = 71160 ≈ 17790×4 → float32。檔名 `channelX_dev_?_<id>_<type>` 編碼 device/channel id。
- 難點：`<id>`（如 10024、1053576）→ 語意（lat/lon/speed/rpm…）的對照表未公開。**但本 rcz 正是從
  `b1(5)_rc.vbo` 匯入再匯出**（同 17791 列），可拿配對 VBO 的值**交叉比對反推**每個 channel id 的意義。
- 接入路線：fflate 解 zip → 讀 JSON → 各 channel 檔依大小/後綴判 float32/float64 → 用配對 VBO 建立 id↔名對照。

### XRK / XRZ（AiM SmartyCam / Solo 2 DL / MyChron5）— 可行性「**中**」（維持，工程量最大）
- 實測（`123_A_a_1018.xrk`，2.5MB）：自訂二進位，**chunk 式**結構，用 `<hXXX …>` … `<XXX…>` 標籤包住區塊：
  `<hCNF>`（設定）、`<hCHS>`（channel 定義，內嵌可讀名：`MCLK/Master Clk`、`Lap Time`、
  `LogT/Logger Temperature`、`VBEx/External Voltage`、`PreT/Predictive Time`、`bstD/Prdt Best Diff`…）、
  `<hCDE>`、尾段 `<hGPS>`、`<hLAP>`、`<hRCR>123`（車手號）、`<hNTE>`（註記）。`@AIM` 標記出現多次。
- 與 `racer-coder/TrackDataAnalysis` ／ `libxrk` 的逆向描述吻合（chunk-based，footer metadata）。
- 接入路線：移植 libxrk/TrackDataAnalysis 的 chunk 解析邏輯到 TS，或把 libxrk 編成 WASM（Pyodide 路線已證可行但體積大）。
  四個樣本（含 15MB 的 `CHENG_ARK_a_2570.xrk`）足以驗證。

### 更新後的建議優先序（基於真檔）
1. **RCNX（Qstarz）** — 標準 SQLite，最低風險、最高槓桿（只欠 `sql.js` 依賴 + 開 db 看 schema）。
2. **RCZ（RaceChrono）** — 零新依賴（fflate 已有），JSON+raw float；只欠 channel-id↔名對照（可用配對 VBO 反推）。
3. **XRK（AiM）** — 最大工程，但結構已摸清＋有 MIT 參考實作；四樣本齊備。

### 共通的架構前置（三者都需要）
- `Importer.detect` 目前只看 `headText`（字串）；ZIP/二進位需改看 **`headBytes: Uint8Array`**（看 magic：ZIP=`50 4B`、XRK=`3C 68 43 4E 46`）。
- `Importer.parse` 目前只吃 text；二進位需新增 **`parseBinary(bytes: Uint8Array)`**（或把 `parse` 簽名泛化為吃 `ArrayBuffer`）。
- RCNX 需評估引入 **`sql.js`（WASM）** 依賴；RCZ/XRK 不需新依賴（XRK 純 TS 移植的話）。
- 這些都是先前 `ARCHITECTURE-FORMATS.md` §6 已預告的擴充點，等實作第一個二進位 importer 時一併落地。

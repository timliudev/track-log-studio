# 匯入／匯出格式支援狀態

> **本檔 = 進度／已知限制／待完成的唯一真實來源**（✅／🔧／🛠️／📋）。
> 每個格式 ↔ importer/exporter/formatId/decoder 的**架構對應**不在此重列，見
> [ARCHITECTURE-FORMATS.md §4](ARCHITECTURE-FORMATS.md#4-目前支援矩陣)。

本檔追蹤多格式匯入／匯出的進度。詳細架構見
[ARCHITECTURE-FORMATS.md](ARCHITECTURE-FORMATS.md)；格式研究與接入評估見
[FORMAT-SUPPORT-RESEARCH.md](specs/FORMAT-SUPPORT-RESEARCH.md)；AiM XRK 二進位規格見
[XRK-FORMAT-SPEC.md](specs/XRK-FORMAT-SPEC.md)。

## ✅ 已完成
- **可插拔 Importer 架構**：`Importer` 介面（`id` / `extensions` / `detect` / `parse`）+ registry，對稱於既有 `Exporter`；`detect`/`parse` 支援文字與二進位（`headBytes` + `parseBinary`）。parse worker 依 `importerId` 路由，所有格式走同一條 worker 路徑。
- **匯入格式**：
  - `loga`、`nmea`（既有，包裝進 registry）
  - `vbo`（RaceLogic）—— 新增 `parseVbo`，為 VBO 匯出的逆運算，round-trip 驗證通過；可在分析器開啟。
  - `csv`（通用遙測）—— RFC 4180 逗號分隔資料；第一個非空白列為標題，需有 `Time` 或 `Timer`。支援引用欄位、空白/無效值、以及本工具輸出的 `TLS_Metadata` 註記 round-trip。
  - `rcz`（RaceChrono）—— 第一個二進位格式。ZIP + `session.json` + 逐通道二進位（int32/int64/float64）；channel id 解碼（`rc_analog_*`/`rc_digital_*`/具名表）；GPS lat/lon int32 配對、速度 mm/s、heading 毫度；GPS↔ECU 以各自時間戳最近鄰對齊。真檔驗證 17791 列／147 channels／座標正確。**整機備份亦已支援（F3）**——RaceChrono 的「整機備份」副檔名相同但結構不同：多場巢狀於 `sessions/session_<KEY>/`（實測 2.18 GB／解壓約 11.9 GB／22883 檔／673 場）。`isRczBackup`／`listRczSessions` 以 fflate `unzipSync(data,{filter})` **只 inflate 各場的小 JSON** 來列場次（絕不碰 `channel_*` blob，否則 OOM），FileBar 出場次 picker；`parseRczBackupSession` 只抽選中場解碼。GPS 裝置由 `sessionfragment.json` 的 `type===1` 自動判定（非硬寫 100，真檔為 id 200）；master clock 取**時間戳樣本數最多**的裝置（真檔 CAN 50 Hz／248 萬筆 遠密於 GPS 10 Hz／3.4 萬筆），其餘裝置以既有最近鄰對齊；`id 2` = 累積距離（mm→km，末值等於 `session.json` 的 `lengthDistance`，已驗證）。⚠️ 程式碼目前仍把 int32 加速度／陀螺儀維持**原始值、不給單位**（scale 待套用）——但 **scale factor 已於 2026-07-24 標定完成**：見 `docs/specs/RCZ-FORMAT-SPEC.md`（int32 = 物理值×1000，加速度原始單位 mm/s²，`/9806.65` 得 G；陀螺儀毫度/秒；磁力計 nT），以使用者同場多格式匯出（`LogaExample/session_20260315_1642_極限/`）逐點對照 RaceChrono 自己的 CSV 驗證，中位誤差 0。同份文件另列出單場匯出路徑的 7 項缺陷（最嚴重：`parseRcz` 硬寫 100=GPS/101=ECU，遇到「內建 GPS+內建 IMU+RC3」的場次會整份匯壞），尚未修。
  - `xrk`（AiM Solo 2 DL / MyChron5）—— 訊息流(H-訊息含 checksum + sample 訊息);CNF/CHS channel 表;decoder(int16/float16/int32/gear);各通道取樣率以 MCLK 主時鐘重採樣;GPS 為 ECEF X/Y/Z → Bowring 轉 WGS84 經緯度。真檔驗證 95890 列/座標正確/圈時合理。**`.xrz`（zlib 壓縮的 `.xrk`）已支援** —— `parseXrk` 偵測 RFC 1950 zlib magic 後用 `fflate` 的 `Unzlib` 串流 inflate（含解壓炸彈防護,512 MB 上限,同 `zip.ts` 的作法）,還原成 `.xrk` bytes 再走同一 parser。
  - `rcnx`（Qstarz LT-Q6000 / Q6000S，QRacing）—— ZIP 內含**標準 SQLite**（每場 `sess_N.db` 的 `WayPoints` 表）。用 `sql.js`（WASM，動態載入、PWA 預快取）讀取；一檔多 session 時取 `WayPoints` 列數最多者；lat/lon 為十進位度（無縮放）、speed km/h、Gx/Gy/Gz g。真檔驗證 22402 列／座標正確（TWN-ARK）／速度 ~84 km/h／model LT-Q6000。
- **圈速時間帶過濾**：設有效圈速區間，區間外圈自動排除；`excluded` 為「手動排除 ∪ 區間外」之聯集，無區間時與舊行為一致。
- 248 單元測試（格式匯入完成當下的快照數字；目前全專案測試數已隨後續功能持續增加，見 README/`npm test` 的即時結果）、production build 通過、`npm audit` 0 漏洞。

## 🔧 已修正
- VBO 匯入穩健性：超大 grid 配置上限（防 OOM）、超大 `[column names]` 行的堆疊溢位。
- README 部署描述更正為 **Cloudflare Workers**（原誤植 Pages）。
- XRK 規格 H-message opcode 端序更正（`0x6863` → `0x683c`）。
- **RCNX 掉最後一圈（B104）**：`buildLapNumberChannel` 的尾巴沿用最後圈值、缺收尾 crossing，`detectLapsByChannel` 少偵測一圈（142.rcnx 8/4/7→7/3/6）。修法：尾巴段 counter +1 給最後一圈收尾。真檔驗證恢復 8/4/7。（見 ISSUES B104。）

## 🛠️ 待修 / 已知限制
- RCZ 同名通道後綴為 cosmetic 差異（AFR 第二份命名為 `rc_air_fuel_ratio_3`，與 VBO 端 `_2` 不一致）；不影響資料。
- VBO 匯入的時間為相對重建（VBO 僅存 time-of-day，屬格式本身的有損特性）。

## 📋 待完成
> 原列於此的兩項 RCNX 待辦均已落地（本節先前過期，2026-07-23 更正）：
> - **RCNX 圈資料 → ✅ 已完成**：`parseRcnx` 的 `readSanaLaps` 讀 `sana_N.db` 的 `lap`
>   表（`start_wp`/`finish_wp`/`bFailed`），`buildLapNumberChannel` 將官方圈邊界暴露為
>   `IR_LapNumber` 計數通道，既有 `detectLapsByChannel`（ECU 圈來源）零改動即接收；
>   單元測試見 `test/import/rcnx.test.ts` 的「lap data from sana_N.db」。
> - **RCNX 多 session 選擇 → ✅ 已完成（挑一場）**：`listRcnxSessions` 列舉各場，
>   `FileBar.vue` 的 `pendingRcnx` 內嵌選擇器讓使用者挑要匯入哪一場（預設最大場、
>   顯示每場是否含官方圈），`sessionIndex` 一路經 `useLogImport`→`parse.worker`→`parseRcnx`。
>
> 真正殘留（皆為次要便利／niche，未排程）：
- **RCNX 一次載入全部 session**：目前一檔一次挑「一場」匯入；若要一鍵把 N 場全部展開為 N 個 LogSession 同時載入，需擴充 worker 協定（一檔多 LogSession 回傳）。屬便利性，非阻塞（可重複挑不同場逐一載入）。
- **RCNX 官方分段（split/sector）**：目前只讀 `lap` 表的圈邊界；分析器本就用 gate 幾何自算 sector，官方 split 時間未另行匯入（niche）。

> 以下項目已完成，從舊版待辦移出：**任意格式互轉**（`converterStore.convertAll()` 對任何已載入格式 loga/nmea/vbo/rcz/xrk/rcnx 一視同仁跑 export registry，見該檔函式註解）；**匯出側 registry 化**（`src/domain/export/registry.ts` 的 `EXPORT_FORMATS`，見 ARCHITECTURE-FORMATS.md §4 附註）；**Sector 完整性判定有效圈**（`useSectors`/`SectorPanel.vue`，「N 圈未通過 sector 檢查」已併入排除邏輯，見使用手冊 §4.5）。

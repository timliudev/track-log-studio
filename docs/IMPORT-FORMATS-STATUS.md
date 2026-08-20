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
  - `rcz`（RaceChrono）—— 第一個二進位格式。ZIP + `session.json` + 逐通道二進位（int32/int64/float64）；channel id 解碼（`rc_analog_*`/`rc_digital_*`/具名表）；GPS lat/lon int32 配對、速度 mm/s、heading 毫度；GPS↔ECU 以各自時間戳最近鄰對齊。真檔驗證 17791 列／149 channels／座標正確。**單場匯出解析已於 2026-07-24 全面重寫（B106，分支 `fix/b106-rcz-single-session`）**：改與整機備份共用核心 `src/domain/import/rcz/parseRczCore.ts`，裝置角色一律讀 `sessionfragment.json` 的 `type`（不再硬寫 100=GPS/101=ECU；先前遇到「內建 GPS+內建 IMU+RC3」場次會整份匯壞）；int32 scale 已套用（acc `/9806.65`→G、gyro/magn `/1000`→deg·s⁻¹/µT、altitude mm→m、DOP `/1000`）、float64 不縮放、`INT32_MAX`→NaN、id 2 距離只留一條（GPS 優先）、RC3 analog/digital（20002/20003-20007/20010/20011-20020）具名、官方圈次轉 `IR_LapNumber`。真檔逐點吻合（`rc_x_acc[0]=1.27781`=12531/9806.65；distance 末值 3.7176 km），2261/2261 綠。**整機備份亦已支援（F3）**——RaceChrono 的「整機備份」副檔名相同但結構不同：多場巢狀於 `sessions/session_<KEY>/`（實測 2.18 GB／解壓約 11.9 GB／22883 檔／673 場）。`isRczBackup`／`listRczSessions` 以 fflate `unzipSync(data,{filter})` **只 inflate 各場的小 JSON** 來列場次（絕不碰 `channel_*` blob，否則 OOM），FileBar 出場次 picker；`parseRczBackupSession` 只抽選中場解碼。GPS 裝置由 `sessionfragment.json` 的 `type===1` 自動判定（非硬寫 100，真檔為 id 200）；master clock 取**時間戳樣本數最多**的裝置（真檔 CAN 50 Hz／248 萬筆 遠密於 GPS 10 Hz／3.4 萬筆），其餘裝置以既有最近鄰對齊；`id 2` = 累積距離（mm→km，末值等於 `session.json` 的 `lengthDistance`，已驗證）。✅ int32 加速度／陀螺儀 scale **已於 2026-07-24 標定並套進 `parseRczCore.ts` 的 `int32ScaleFor`**：int32 = 物理值×1000（加速度原始 mm/s²，`/9806.65` 得 G；陀螺儀毫度/秒；磁力計 nT），以使用者同場多格式匯出（`LogaExample/session_20260315_1642_極限/`）逐點對照 RaceChrono 自己的 CSV 驗證，中位誤差 0。完整規格與驗證數字見 `docs/specs/RCZ-FORMAT-SPEC.md`。
  - `xrk`（AiM Solo 2 DL / MyChron5）—— 訊息流(H-訊息含 checksum + sample 訊息);CNF/CHS channel 表;decoder(int16/float16/int32/gear);各通道取樣率以 MCLK 主時鐘重採樣;GPS 為 ECEF X/Y/Z → Bowring 轉 WGS84 經緯度。真檔驗證 95890 列/座標正確/圈時合理。**`.xrz`（zlib 壓縮的 `.xrk`）已支援** —— `parseXrk` 偵測 RFC 1950 zlib magic 後用 `fflate` 的 `Unzlib` 串流 inflate（含解壓炸彈防護,512 MB 上限,同 `zip.ts` 的作法）,還原成 `.xrk` bytes 再走同一 parser。
  - `rcnx`（Qstarz LT-Q6000 / Q6000S，QRacing）—— ZIP 內含**標準 SQLite**（每場 `sess_N.db` 的 `WayPoints` 表）。用 `sql.js`（WASM，動態載入、PWA 預快取）讀取；一檔多 session 時取 `WayPoints` 列數最多者；lat/lon 為十進位度（無縮放）、speed km/h、Gx/Gy/Gz g。真檔驗證 22402 列／座標正確（TWN-ARK）／速度 ~84 km/h／model LT-Q6000。
- **圈速時間帶過濾**：設有效圈速區間，區間外圈自動排除；`excluded` 為「手動排除 ∪ 區間外」之聯集，無區間時與舊行為一致。
- 248 單元測試（格式匯入完成當下的快照數字；目前全專案測試數已隨後續功能持續增加，見 README/`npm test` 的即時結果）、production build 通過、`npm audit` 0 漏洞。

## 🔧 已修正
- VBO 匯入穩健性：超大 grid 配置上限（防 OOM）、超大 `[column names]` 行的堆疊溢位。
- README 部署描述更正為 **Cloudflare Workers**（原誤植 Pages）。
- XRK 規格 H-message opcode 端序更正（`0x6863` → `0x683c`）。
- **RCNX 掉最後一圈（B104）**：`buildLapNumberChannel` 的尾巴沿用最後圈值、缺收尾 crossing，`detectLapsByChannel` 少偵測一圈（142.rcnx 8/4/7→7/3/6）。修法：尾巴段 counter +1 給最後一圈收尾。真檔驗證恢復 8/4/7。（見 ISSUES B104。）
- **`.rcz` → `.vbo` 匯出欄位映射失準（B120–B126）**：`domain/export/vbo/` 這套映射原本是為 `.loga`(文字欄名)設計,套用到 `.rcz`(數字 id 造出的 `rc_*` 名)時整批撞號/誤判——已是合法 RaceChrono 識別符的頻道被 Allocator 重新編號、RC3 `digital1`(固定 RPM 槽)未被識別、標準 GPS 欄位(`sats`/`height`)沒接上來源資料、單位被洗成 `raw`/`bool`、整條無資料的頻道仍輸出成假 0、數位/類比判定規則過脆、絕對時鐘用錯了 epoch。全數修正(F7 RC3 Analog 自訂命名表待拍板,不在此批)。詳見 ISSUES B120–B126。

## 🛠️ 待修 / 已知限制
- RCZ 同名通道後綴為 cosmetic 差異（AFR 第二份命名為 `rc_air_fuel_ratio_3`，與 VBO 端 `_2` 不一致）；不影響資料。
- VBO 匯入的時間為相對重建（VBO 僅存 time-of-day，屬格式本身的有損特性）。
- **數位/類比誤判殘留（B127，[[B125]] 的殘留限制）** —— 匯出時判斷一個頻道該進 `.vbo` 的
  digital 還是 analog 槽，目前只有「值域啟發式」可用，而值域**分不出**「整場都沒觸發過的真實
  數位旗標」（如 `Malf8.Malf_On`、`Pit_SW_On`）與「值剛好恆為某個常數的類比頻道」。`.loga` 的
  `IR_LapNumber` / `IR_LapTime` / `SimRPM` / `MapNum` 這類本質是類比、但整趟記錄恆 0/恆某常數的
  頻道，因此仍被誤判進數位槽。正確修法要靠**頻道名稱／說明文字**慣例（`_SW`/`Malf`/`_Act`/`_En`
  …）當佐證，但那條規則得涵蓋所有既有 ECU 命名慣例、有誤判風險（B125 第一版誤傷 `.loga` golden
  fixture 108 個頻道），屬待 user 拍板的設計決策，**刻意未實作**。→ [ISSUES.md B127](ISSUES.md)
- **RC3 Analog 槽位仍只能顯示代號（F7，design-first、待拍板）** —— `.rcz` 檔內沒有任何頻道文字
  標籤，Analog 1–15 / Digital 2 的語意只存在使用者的 RaceChrono / ECU 設定裡，程式無從得知，
  因此匯入顯示與匯出欄名只能用 `rc_analog_N` / `rc_digital_N` 這種代號。這是 B120–B126 修完後
  **剩下的唯一**「名字看不懂」來源。需要一個可存成 preset、隨裝置記憶的「槽位→真名（含單位）」
  對應表；schema 與 UX 皆待 user 拍板，**拍板前不實作**。設計草案見
  [`specs/F7-RC3-ANALOG-NAMING-DESIGN.md`](specs/F7-RC3-ANALOG-NAMING-DESIGN.md)。
  → [ISSUES.md F7](ISSUES.md)

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

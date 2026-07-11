# 匯入／匯出格式支援狀態

本檔追蹤多格式匯入／匯出的進度。詳細架構見
[ARCHITECTURE-FORMATS.md](ARCHITECTURE-FORMATS.md)；格式研究與接入評估見
[FORMAT-SUPPORT-RESEARCH.md](specs/FORMAT-SUPPORT-RESEARCH.md)；AiM XRK 二進位規格見
[XRK-FORMAT-SPEC.md](specs/XRK-FORMAT-SPEC.md)。

## ✅ 已完成
- **可插拔 Importer 架構**：`Importer` 介面（`id` / `extensions` / `detect` / `parse`）+ registry，對稱於既有 `Exporter`；`detect`/`parse` 支援文字與二進位（`headBytes` + `parseBinary`）。parse worker 依 `importerId` 路由，所有格式走同一條 worker 路徑。
- **匯入格式**：
  - `loga`、`nmea`（既有，包裝進 registry）
  - `vbo`（RaceLogic）—— 新增 `parseVbo`，為 VBO 匯出的逆運算，round-trip 驗證通過；可在分析器開啟。
  - `rcz`（RaceChrono）—— 第一個二進位格式。ZIP + `session.json` + 逐通道二進位（int32/int64/float64）；channel id 解碼（`rc_analog_*`/`rc_digital_*`/具名表）；GPS lat/lon int32 配對、速度 mm/s、heading 毫度；GPS↔ECU 以各自時間戳最近鄰對齊。真檔驗證 17791 列／147 channels／座標正確。
  - `xrk`（AiM Solo 2 DL / MyChron5）—— 訊息流(H-訊息含 checksum + sample 訊息);CNF/CHS channel 表;decoder(int16/float16/int32/gear);各通道取樣率以 MCLK 主時鐘重採樣;GPS 為 ECEF X/Y/Z → Bowring 轉 WGS84 經緯度。真檔驗證 95890 列/座標正確/圈時合理。**`.xrz`（zlib 壓縮的 `.xrk`）已支援** —— `parseXrk` 偵測 RFC 1950 zlib magic 後用 `fflate` 的 `Unzlib` 串流 inflate（含解壓炸彈防護,512 MB 上限,同 `zip.ts` 的作法）,還原成 `.xrk` bytes 再走同一 parser。
  - `rcnx`（Qstarz LT-Q6000 / Q6000S，QRacing）—— ZIP 內含**標準 SQLite**（每場 `sess_N.db` 的 `WayPoints` 表）。用 `sql.js`（WASM，動態載入、PWA 預快取）讀取；一檔多 session 時取 `WayPoints` 列數最多者；lat/lon 為十進位度（無縮放）、speed km/h、Gx/Gy/Gz g。真檔驗證 22402 列／座標正確（TWN-ARK）／速度 ~84 km/h／model LT-Q6000。
- **圈速時間帶過濾**：設有效圈速區間，區間外圈自動排除；`excluded` 為「手動排除 ∪ 區間外」之聯集，無區間時與舊行為一致。
- 248 單元測試、production build 通過、`npm audit` 0 漏洞。

## 🔧 已修正
- VBO 匯入穩健性：超大 grid 配置上限（防 OOM）、超大 `[column names]` 行的堆疊溢位。
- README 部署描述更正為 **Cloudflare Workers**（原誤植 Pages）。
- XRK 規格 H-message opcode 端序更正（`0x6863` → `0x683c`）。

## 🛠️ 待修 / 已知限制
- RCZ 同名通道後綴為 cosmetic 差異（AFR 第二份命名為 `rc_air_fuel_ratio_3`，與 VBO 端 `_2` 不一致）；不影響資料。
- 匯出側尚未 registry 化：`Rc3NmeaExporter`、VBO 匯出各有不同呼叫慣例（見 ARCHITECTURE-FORMATS §7）。
- VBO 匯入的時間為相對重建（VBO 僅存 time-of-day，屬格式本身的有損特性）。

## 📋 待完成
- **任意格式互轉**：讓匯入的 `vbo` / `rcz` / `xrk` / `rcnx` 也能再匯出／轉檔 —— 需把 `fileStore` 目前 `fileType === 'loga'` 的過濾改為「能力旗標」。
- **RCNX 多 session 展開**：目前一檔多 session 只取最大那場；若要全部展開需擴充 worker 協定（一檔多 LogSession）。
- **RCNX 圈資料**：`sana_N.db` 內有官方圈/分段（lap/split），目前未讀；之後可接進 analyzer 圈資料。
- **Sector 完整性判定有效圈**：需先定義「彎是否真的跑過」的準則（彎速？逐 sector 通過閘門？），可用與時間帶過濾相同的 union 方式接進排除機制。

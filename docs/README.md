# docs/ 文件地圖

這個資料夾的每份文件各有明確職責，避免同一件事寫在多處而失去同步。**動手前先看這張表**，
把內容寫進負責它的那份文件，不要在別處另起爐灶。

## 各文件職責

| 文件 | 類別 | 負責什麼（唯一真實來源） |
|---|---|---|
| [`DESIGN.md`](./DESIGN.md) | 主設計 | 專案目標、技術選型、架構、逐功能設計決策、decision log。**穩定的「為什麼」**，不放跑動式待辦。 |
| [`ARCHITECTURE-FORMATS.md`](./ARCHITECTURE-FORMATS.md) | 子系統設計 | Importer/Exporter/LogSession 架構；**§4 格式支援矩陣**（每格式 ↔ importer/formatId/decoder 的 how）。 |
| [`MULTI-SESSION-ANALYSIS-DESIGN.md`](./MULTI-SESSION-ANALYSIS-DESIGN.md) | 子系統設計 | 多檔同時分析 + 全域疊加分析設計（§9 有待拍板的開放問題）。 |
| [`CLOUD-TRACK-DESIGN.md`](./CLOUD-TRACK-DESIGN.md) | 子系統設計 | 雲端賽道機制（自動套用 + 公開賽道庫）設計（§8 有待使用者決策）。**尚未實作**。 |
| [`TRACK-LIBRARY-OPTIONS.md`](./TRACK-LIBRARY-OPTIONS.md) | 方案評比 | 雲端後端四方案（GitHub/Firebase/Cloudflare/Supabase）比較報告，**等二次拍板**。 |
| [`IMPORT-FORMATS-STATUS.md`](./IMPORT-FORMATS-STATUS.md) | 狀態快照 | 格式匯入/匯出的**完成進度、已知限制、待完成**（✅/🔧/🛠️/📋）。 |
| [`PHASE5-MERGE-STATUS.md`](./PHASE5-MERGE-STATUS.md) | 狀態快照 | GPS 場次合併原型建置紀錄（已 shipped，保留為歷史 rationale）。 |
| [`ISSUES.md`](./ISSUES.md) | 活動追蹤 | **逐項 bug/請求的狀態 + 修復 commit**（B/M 編號）。跨會話的活清單。 |
| [`specs/`](./specs/) | 研究 | 格式/演算法研究：CVT 動力、格式接入評估、XRK/RCNX 二進位規格。 |
| [`manual/`](./manual/) | 使用手冊 | 對使用者的 zh-Hant / en 操作說明。 |
| `journal/` | 工時日誌 | 每會話開發日誌。**已 gitignore，不進版控**（避免洩漏工時）。 |

## 「待辦看哪裡」— 三層分工

待辦刻意分三層，各有其位，不互相重列：

1. **短期、具體、可執行的 bug/請求** → [`ISSUES.md`](./ISSUES.md)（唯一真實來源，含 commit）。
2. **某子系統待使用者拍板的設計決策** → 該子系統設計文的「開放問題」段
   （CLOUD-TRACK §8、MULTI-SESSION §9、TRACK-LIBRARY-OPTIONS）。
3. **跨子系統、待方向拍板的長期項目** → [`DESIGN.md §11c`](./DESIGN.md)。
   一旦拍板、拆成可執行條目，就搬進 `ISSUES.md`，並從 §11c 移除。

格式的完成進度只在 `IMPORT-FORMATS-STATUS.md`；格式的架構對應只在 `ARCHITECTURE-FORMATS.md §4`。

## 維護原則

- 一件事只在一處是「真實來源」，其他地方用連結指向它，不複製內容。
- 狀態（會變的）與設計理由（穩定的）分開放：前者進 STATUS/ISSUES，後者進 DESIGN/子系統設計文。
- 新增文件前，先確認上表沒有已負責該主題的文件。

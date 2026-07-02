# 夜間自動作業報告 — 2026-07-03(02:00 → 08:30)

> 給早上的你:這是今晚全自動作業的完整記錄。基準點 develop `b91c664`(509 tests)。
> 所有變更都只進 develop(main 未動,等你驗收)。每個任務由獨立 Sonnet 5 sub-agent
> 在隔離 worktree 完成,feature → develop `--no-ff` 合併,小步 commit。

## 任務總覽(討論定案 02:05)

| # | 任務 | 狀態 | 分支 / 合併 commit | 備註 |
|---|------|------|--------------------|------|
| T1 | AnalyzerView composables 抽取(B7 建議) | ⏳ 進行中 | — | 最先做,其他 UI 任務排後避免衝突 |
| T2 | G-G echarts bundle 拆分(dynamic import) | ⬜ 排隊 | — | 479kB chunk 延遲載入 |
| T3 | RS3 CSV 註解行容錯驗證 | ⏳ 進行中 | — | 補測試確認 |
| T4 | 傳動比設定持久化(idb circuit setup) | ⬜ 排隊 | — | 0702 遺留 |
| T5 | A2/A3 雲端賽道機制設計文件 | ✅ 完成 | `docs/cloud-track-design` → `1219390` | 只寫文件,待你拍板 |
| T6 | Phase 5 合併 UI | ⬜ 排隊 | — | align/merge 核心已在 develop |
| T7 | 彎道偵測接上 UI | ⬜ 排隊 | — | spike 已合併,接 gate 直接載入流程 |
| T8 | B6 彈性面板佈局 | ⬜ 排隊 | — | ⚠️ 需你視覺驗收 |
| T9 | 使用手冊補新功能(zh+en) | ⬜ 排隊 | — | 最後做 |

## 執行順序與理由

1. **T1 先單獨做** — composables 抽取大動 AnalyzerView,先落地,T6/T7/T8 才在乾淨基礎上做,避免合併衝突。
2. **T3/T5 與 T1 平行** — 純測試 / 純文件,零重疊。
3. **T2/T4 第二波平行** — 不碰 AnalyzerView 主體。
4. **T6 → T7 → T8 依序** — 三者都動 AnalyzerView 區域,序列化執行。
5. **T9 最後** — 等功能都定案才寫手冊。

## 各任務詳細記錄

### T5 — A2/A3 雲端賽道機制設計文件 ✅(develop `1219390`)

產出 [docs/CLOUD-TRACK-DESIGN.md](CLOUD-TRACK-DESIGN.md)(581 行,繁中)。**純設計、零程式碼變更**,早上請優先看它的 §8「開放問題」— 有 8 個要你拍板的決策。主要建議(都可推翻):

1. **Schema**:`TrackDefinitionV1`(共享:geo/名稱/起終點線/gates/授權)與 `PersonalTrackOverlayV1`(個人:欄位配置/offsets/傳動比/顏色)明確分離,線/gate 直接沿用現有 `LapLine` 形狀。
2. **Repo**:獨立 `track-log-studio-tracks` repo(授權、CI、貢獻門檻考量)。
3. **發佈**:混合式 — 打包時內建一份快照(離線可用),執行期經 **jsDelivr** 背景更新。
4. **比對**:沿用現有 `circuitKey`/`circuitKeysMatch`;優先序 個人 overlay > 共享庫 > 自動偵測,多 layout 有選擇器 + detach。
5. **個人雲端備份**:Google Drive `drive.appdata`(比 GitHub Gist 門檻低),列為第 4 期。
6. **賽道資料授權**:建議 CC0-1.0。

分期:①現有本地持久化對齊 schema → ②唯讀消費共享庫 → ③開放社群 PR → ④個人雲端。

## 驗收清單(早上請你看)

(收尾時整理)

## 事件記錄

- **02:1x 電腦當機重啟** — 第一波 5 個 sub-agent 全滅。災情盤點:4 個 worktree 的分支都還停在 `ca572d3` 零 commit(只有 npm install 殘留),無工作損失;已清除殘骸 worktree + 空分支,02:2x 全部重新啟動。
- **T1 首次啟動時 agent 遞迴委派**(自己又開背景 agent 然後直接結束,沒做事)— 重啟後所有 agent 提示都加上「禁止再委派、必須親自做」。

## 決策記錄

- 全部進 develop,main 不動 — 沿用既定流程(release 等視覺驗收)。
- A2/A3 只出設計文件,機制拍板後另行實作。
- 提早做完會自選低風險 backlog 繼續(小步 commit + 記錄於此)。

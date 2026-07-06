# 晚間自動工作 2026-07-06

> 使用者 17:28 下班,授權全自動完成。策略:所有任務交 sub-agent(sonnet)、小步快跑 commit、
> 全部只合進 develop(不 release、不 push)、每次合併後查 claude.ai 用量(週限 98% / session 95% 即停)。
> 開工時用量:session 7%、週限 All models 1% / Fable 2%(週限已於今晨重置)。

## 使用者拍板決策(出門前確認)

1. **只合進 develop** — 不 release 到 main、不部署,等使用者驗收。
2. **Cloud-track §8 跳過** — repo/授權/CDN/OAuth 決策仍等使用者。
3. **Backlog 全做** — 5 項修正優先,之後 Phase5-UI 收尾、G-G bundle split、測試/品質補強。

## 任務清單

### Wave 1(並行)

| # | 任務 | 分支 | 狀態 |
|---|------|------|------|
| T1 | 賽道地圖/圖表1 預設切到下方文字;拉大視窗放大圖表而非納入文字 | feature/dashboard-layout-fixes | ⬜ |
| T3 | 新增 XY 圖不隨視窗大小變化 | feature/dashboard-layout-fixes | ⬜ |
| T4 | 「新增圖表」按鈕與「重設布局」放在一起 | feature/dashboard-layout-fixes | ⬜ |
| T5 | 查證布局是否持久化(loadLayout?),不會存就加,會存就讓 UI 可感知 | feature/dashboard-layout-fixes | ⬜ |
| T2 | 齒比計算:輪胎規格(120/80-12)換算周長 + 直接輸入周長 + 從 speed 倒算 | feature/tire-spec-input | ✅ 已合併 develop 2554fdc(810 tests 綠) |

### Wave 2(Wave 1 合併後)

| # | 任務 | 分支 | 狀態 |
|---|------|------|------|
| W2a | Phase5-UI 收尾 → 實際剩餘:SessionMerge 合併前 speed 疊圖預覽 + speed 通道 fallback(見 PHASE5-MERGE-STATUS.md「Not done」) | feature/merge-preview | ⬜ |
| W2b | G-G bundle split → **查證發現已完成**:chore/gg-lazy-chunk(df784d8「GgPanel 改 defineAsyncComponent — echarts 拆獨立 chunk」)已合入 develop;Wave 3 改為驗證 build 產物確實拆出 echarts chunk | — | ✅(待驗證) |

### Wave 3

| # | 任務 | 狀態 |
|---|------|------|
| W3a | 測試/品質補強:code review、覆蓋補強、npm outdated/audit | ⬜ |

## 進度紀錄

- 17:35 開工。用量檢查通過,建立本文件。
- 17:40 Wave 1 兩個 sub-agent 啟動(dashboard-layout-fixes、tire-spec-input,各自獨立 worktree)。
- 17:42 偵察:G-G bundle split 已於先前完成並合入 develop(df784d8);Phase5-UI 實際剩餘為 SessionMerge 合併前預覽疊圖。
- 17:44 T2 agent 首次回合異常(轉派後即結束、無分支產出),已叫回要求親自實作。
- (中間 Claude Code 程序重啟,兩個 agent 被中斷;進度都留在分支上,沒有遺失)
- 22:49 使用者睡前更新規則:**週限 98% / 5hr 限 95%(先到先停,開 timer 等重設後自動續)、08:30 後停止所有 git 操作只留文件、用量改用本機 claude-monitor 工具**(`claude-monitor --once --output json`;本機估算模式拿不到週限,週限改偶爾瀏覽器抽查,目前 1–2% 無風險)。
- 22:52 檢查中斷時進度:T1(7a54c8c)/T3(bb7b966)/T4(8e804c8)已 commit;T2 有 3 commits(4074342/93bb52e/4c8388a)+ 未提交的 UI 接線;兩個 agent 已從 transcript 恢復,分別收尾 T5 與 T2-UI。
- 23:05 **T2 完成合併**(develop 2554fdc,+19 測試 → 810 全綠,5hr 窗 8.8%)。三種周長來源:規格解析容錯(ZR/B/D、M/C、載重速度等級)+一鍵套用可微調;直接輸入模式顯示規格參考值;speed/RPM 倒算(q 值聚類+保序檔位指派+中位數,speed≥10km/h、RPM≥3000、q 變動≤2% 閘門,<10 樣本回 NaN;單檔記錄需參考值否則誠實回 NaN)。待使用者實機驗收:用真實多檔位 log 驗證倒算估計值;CVT 模式無倒算(本質不可解);倒算結果訊息不隨輸入變動自動清除(小 UX 可再議)。
- 23:00 使用者指出上次仍撞牆中斷 → 用量協議強化為四層:①5hr 窗 ≥80% 不再發新 agent(一個 sonnet agent ≈ 10–15%)②≥90% 即開始收尾(留 5% 給收尾本身)③**事前保險:已排 03:05 與 08:05 兩個 dead-man 恢復排程**(scheduled task,會自行判斷主 session 是否存活/工作是否完成,避免重複)④每個 agent 完成點+發新 agent 前必查 monitor。目前 5hr 窗 6%。

## 給使用者的驗收摘要

(完工後補)

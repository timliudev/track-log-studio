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
| T1 | 賽道地圖/圖表1 預設切到下方文字;拉大視窗放大圖表而非納入文字 | feature/dashboard-layout-fixes | ✅ 7a54c8c(卡片 body 改 flex 欄、uPlot 圖例高度納入計算) |
| T3 | 新增 XY 圖不隨視窗大小變化 | feature/dashboard-layout-fixes | ✅ bb7b966(echarts resize 改傳實測尺寸) |
| T4 | 「新增圖表」按鈕與「重設布局」放在一起 | feature/dashboard-layout-fixes | ✅ 8e804c8(移入工具列同群組) |
| T5 | 查證布局是否持久化(loadLayout?),不會存就加,會存就讓 UI 可感知 | feature/dashboard-layout-fixes | ✅ f0b53b9(**有存 localStorage,但動態新增卡片 reload 會消失 — 已修**) |
| T2 | 齒比計算:輪胎規格(120/80-12)換算周長 + 直接輸入周長 + 從 speed 倒算 | feature/tire-spec-input | ✅ 已合併 develop 2554fdc(810 tests 綠) |

### Wave 2(Wave 1 合併後)

| # | 任務 | 分支 | 狀態 |
|---|------|------|------|
| W2a | Phase5-UI 收尾 → 實際剩餘:SessionMerge 合併前 speed 疊圖預覽 + speed 通道 fallback | — | ✅ **查證後發現 7/5 已完成**(b73bcf8 mergePreview.ts 疊圖+reactive overlay,PHASE5-MERGE-STATUS.md 的 Not done 段落過時已修正);fallback 查證不需要(canonical 速度通道僅 GPS_Speed/Vehicle_Speed 兩個,i18n 提示已點名) |
| W2b | G-G bundle split → **查證發現已完成**:chore/gg-lazy-chunk(df784d8「GgPanel 改 defineAsyncComponent — echarts 拆獨立 chunk」)已合入 develop;Wave 3 改為驗證 build 產物確實拆出 echarts chunk | — | ✅(待驗證) |

### Wave 3

| # | 任務 | 分支 | 狀態 |
|---|------|------|------|
| W3a | 依賴更新(npm outdated/audit)+ build 產物驗證(echarts chunk/precache/chunk 尺寸) | chore/deps-and-build-verify | ✅(部分)aeb6c14 vitest 4.1.10 已合併;**agent 急停前稱兩項任務完成但最終報告遺失** — build 驗證結論與 outdated/audit 全貌需 03:50 續跑時重新確認 |
| W3b | code review(今晚全部 diff)+ 覆蓋補強 | — | ⬜ 03:50 續跑 |

## 進度紀錄

- 17:35 開工。用量檢查通過,建立本文件。
- 17:40 Wave 1 兩個 sub-agent 啟動(dashboard-layout-fixes、tire-spec-input,各自獨立 worktree)。
- 17:42 偵察:G-G bundle split 已於先前完成並合入 develop(df784d8);Phase5-UI 實際剩餘為 SessionMerge 合併前預覽疊圖。
- 17:44 T2 agent 首次回合異常(轉派後即結束、無分支產出),已叫回要求親自實作。
- (中間 Claude Code 程序重啟,兩個 agent 被中斷;進度都留在分支上,沒有遺失)
- 22:49 使用者睡前更新規則:**週限 98% / 5hr 限 95%(先到先停,開 timer 等重設後自動續)、08:30 後停止所有 git 操作只留文件、用量改用本機 claude-monitor 工具**(`claude-monitor --once --output json`;本機估算模式拿不到週限,週限改偶爾瀏覽器抽查,目前 1–2% 無風險)。
- 22:52 檢查中斷時進度:T1(7a54c8c)/T3(bb7b966)/T4(8e804c8)已 commit;T2 有 3 commits(4074342/93bb52e/4c8388a)+ 未提交的 UI 接線;兩個 agent 已從 transcript 恢復,分別收尾 T5 與 T2-UI。
- 23:05 **T2 完成合併**(develop 2554fdc,+19 測試 → 810 全綠,5hr 窗 8.8%)。三種周長來源:規格解析容錯(ZR/B/D、M/C、載重速度等級)+一鍵套用可微調;直接輸入模式顯示規格參考值;speed/RPM 倒算(q 值聚類+保序檔位指派+中位數,speed≥10km/h、RPM≥3000、q 變動≤2% 閘門,<10 樣本回 NaN;單檔記錄需參考值否則誠實回 NaN)。待使用者實機驗收:用真實多檔位 log 驗證倒算估計值;CVT 模式無倒算(本質不可解);倒算結果訊息不隨輸入變動自動清除(小 UX 可再議)。
- 23:12 使用者確認所有待辦都排上、順序自定。並行開出 W2a(feature/merge-preview:SessionMerge 合併前 speed 疊圖預覽 + speed 通道 fallback)與 W3a(chore/deps-and-build-verify:依賴更新 + echarts chunk/precache 驗證)兩個 agent;加上收尾 T5 的布局 agent,共三個並行。W3b(code review + 覆蓋)留待全部合併後串列。
- 23:04 使用者發現 claude-monitor 的重設時間(03:00)與官方 UI(還剩 4hr38min ≈ 03:40)不符 → 確認是 monitor 本機估算把 session 起點取整到整點的已知限制。**官方 UI 為準**,dead-man timer 從 03:05 校正到 03:50;monitor 數字降級為「節奏參考」,收尾決策與 timer 對齊一律以瀏覽器官方讀數為準(已寫入長期記憶)。
- 23:07 **使用者回報官方 session 已 87%(monitor 還估 21.7%——本機估算嚴重低估,正式棄用,回歸網頁查核)** → 依 80%/90% 協議急停:五個背景 agent 全部 TaskStop。幸運的是 T5 與依賴 agent 都已在收尾階段,工作全數已 commit;合併預覽 agent 中途被停、無產出。
- 23:08 合併 feature/dashboard-layout-fixes(T1/T3/T4/T5)與 chore/deps-and-build-verify(vitest 4.1.10)進 develop,**832/832 全綠**。T5 答案:布局有存 localStorage,但動態新增的卡片 reload 後會消失,f0b53b9 已修。
- 23:10 收尾完成。剩餘待辦交給 03:50 dead-man 排程續跑;08:05 排程負責早晨文件補全,08:30 後 git 凍結。
- 23:16 轉派鏈深處的執行者存活並完成調查回報:**W2a 早在 7/5 已完成**(b73bcf8,疊圖+overlay computed+i18n+31 測試都在 develop),它正確地沒有製造重複 commit。已修正 PHASE5-MERGE-STATUS.md 過時段落、刪除多餘的 merge-preview worktree/分支。剩餘待辦縮減為:W3a 報告重確認、W3b code review + 覆蓋、驗收摘要。
- 07:04(7/7)使用者叫醒續跑。官方用量:session 12%(重設 08:49)、週限 21%/Fable 35%。03:50 排程有觸發但無產出;08:05 排程消失 → 補排 08:15 保險。距 08:30 git 凍結約 83 分鐘。
- 07:06 並行發出 W3b(fix/evening-review:昨晚全部 diff 的正確性 review)與 W3a(chore/deps-round2:build 驗證+outdated/audit 報告)兩個 agent,均含反轉派條款與 08:00 硬停線。驗收摘要主體先行寫入本文件。
- 23:00 使用者指出上次仍撞牆中斷 → 用量協議強化為四層:①5hr 窗 ≥80% 不再發新 agent(一個 sonnet agent ≈ 10–15%)②≥90% 即開始收尾(留 5% 給收尾本身)③**事前保險:已排 03:05 與 08:05 兩個 dead-man 恢復排程**(scheduled task,會自行判斷主 session 是否存活/工作是否完成,避免重複)④每個 agent 完成點+發新 agent 前必查 monitor。目前 5hr 窗 6%。

## 給使用者的驗收摘要

**成果全部在 develop(未 release、未 push、main 未動)。基準:昨晚起點 db5113a → 今晨,832+ 測試全綠。**

### 1. 儀表板布局修正(你回報的 1/3/4/5)
| 問題 | 修法 | 怎麼驗收 |
|------|------|----------|
| 賽道地圖/圖表1 切到下面的字 | 卡片 body 改 flex 欄,圖表佔剩餘空間,uPlot 圖例高度納入計算(7a54c8c) | 預設布局下看賽道地圖與時序圖卡片底部文字;再任意拉大縮小視窗,文字始終可見 |
| 新增 XY 圖不隨視窗縮放 | echarts resize 改傳實測尺寸(bb7b966) | 新增 XY 圖後拉視窗,圖表應跟著變 |
| 新增圖表按鈕歸位 | 移入工具列與「重設布局」同群組(8e804c8) | 看工具列 |
| 布局會不會存? | **會存 localStorage;但你若加過自訂圖表,舊版 reload 會消失 — 這 bug 已修**(f0b53b9) | 新增圖表+拖拉位置 → F5 → 全部還原 |

### 2. 輪胎周長三種來源(你回報的 2)
GearPanel 齒比計算現在支援:
- **規格換算**:輸入 `120/80-12`、`120/70ZR17 58W`、`130/70 M/C 12` 等 → 一鍵「套用為周長」後仍可手動微調
- **直接輸入周長**:直接輸入模式下若規格欄可解析,旁邊顯示換算參考值方便對照
- **從記錄倒算**:載入有 speed+RPM 的 log、填好齒比 → 按「從記錄倒算周長」,用 q 值聚類+保序檔位指派估計,顯示估計值與樣本數;資料不足/單檔無參考時會誠實告知而非亂給
- 驗收注意:**用真實多檔位 log 驗證倒算值是否合理**(合成資料已測,實車未驗);CVT 模式無倒算(本質不可解)

### 3. 疊圖預覽(Phase5-UI 收尾)
查證後發現 **7/5 已完成**(SessionMerge 卡片選好兩個 session 後自動顯示 speed 疊圖,nudge 即時反映)— 昨晚沒有重工,只修正了過時的狀態文件。驗收:載入兩個 session → SessionMerge 卡片 → 自動對齊 → 看疊圖隨 ±100ms 微調移動。

### 4. 品質補強(W3a/W3b,今晨 07:06 起跑)
(結果待補 — 見下方進度紀錄末段)

### 5. 未完成 / 等你決定
- Cloud-track §8 決策(repo/授權/CDN/OAuth)— 依你指示跳過,等你拍板
- G-G bundle split 已是既有功能;echarts chunk 的 build 實證見 W3a 報告
- 昨晚三次 agent「轉派鏈」異常浪費了些 token,教訓已寫入記憶(prompt 加反轉派條款)

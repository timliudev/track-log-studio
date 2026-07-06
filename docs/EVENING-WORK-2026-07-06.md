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
| W3a | 依賴更新(npm outdated/audit)+ build 產物驗證(echarts chunk/precache/chunk 尺寸) | chore/deps-and-build-verify | ✅ 完成:vitest 4.1.10 已合併(aeb6c14);7/7 晨補齊報告 — chunk/precache 全數核實正確、依賴全 latest、audit 0 漏洞(詳見驗收摘要 §4) |
| W3b | code review(今晚全部 diff) | fix/evening-review | ✅ 已合併:抓到並修掉 1 個真 bug(倒算結果切檔殘留,4d2f90d),其餘核實無誤 |

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
- 07:52–08:00 輪胎倒算真實 log 驗證收尾:agent 兩份報告互相矛盾(一份稱三 log 成功、一份稱五 log 全 NaN),主 session 寫一次性 scratch 測試親自量測 SuperX 的 q 分佈仲裁 → 連續譜無檔位平台,全 NaN 是正確行為(CVT 車),第一份報告數字為虛構。結論見驗收摘要 §2。scratch 檔已刪,工作樹乾淨。
- 07:31–08:13 使用者追加晨間衝刺,五線並行全數完成:①追加排查乾淨(見上)②手冊補輪胎/布局(304f7b1)③SessionMerge 移除檔案自動重置選取(+2 測試)④**元件測試骨架落地**:@vue/test-utils 2.4.11 + happy-dom 20.10.6,per-file docblock 環境切換零侵入,DashboardCard 冒煙 5 案例 + GearPanel 切檔殘留回歸 2 案例(happy-dom 無 Canvas2D,以檔案內 Proxy no-op context 解決)⑤實機視覺驗收(見 §4.5)。**develop 841/841 全綠(70 檔)**。輪胎倒算真實 log 驗證進行中(08:18 前交報告)。
- 07:15 **全部待辦完成**。W3a:build/依賴全數健康無需變更;W3b:review 修 1 bug 已合併(develop head,832/832 綠)。取消 08:15 保險排程、清理 agent worktree 與已合併分支。今晚成果全在 develop,等使用者驗收後再 release。
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
- 驗收注意:CVT 模式無倒算(本質不可解)
- **7/7 晨真實 log 驗證結論(重要)**:用 LogaExample 五個 log 實測,全部回傳 NaN — 主 session 親自仲裁確認這是**正確行為**:實測 SuperX 的 q=speed/RPM 分佈是連續譜(39 個平滑相接群集、無離散檔位平台),這批 log 是 CVT 速可達,MT 檔位倒算物理上不適用,演算法誠實拒絕而非亂給值。**對你的實際意義:速可達請用規格換算或直接輸入;倒算功能要 MT 檔車的 log 才能發揮**(門檻參數經驗證無需調整;若 log 有 GearNum 通道未來可做 ground-truth 分組,這批 log 的 GearNum 全為 0)。過程插曲:驗證 agent 第一份報告在缺程式碼的 worktree 上編造了成功數字,第二份+主 session 自行實測才定案 — 教訓已入記憶

### 3. 疊圖預覽(Phase5-UI 收尾)
查證後發現 **7/5 已完成**(SessionMerge 卡片選好兩個 session 後自動顯示 speed 疊圖,nudge 即時反映)— 昨晚沒有重工,只修正了過時的狀態文件。驗收:載入兩個 session → SessionMerge 卡片 → 自動對齊 → 看疊圖隨 ±100ms 微調移動。

### 4. 品質補強(W3a/W3b,今晨 07:06 起跑)

**W3a build 驗證+依賴健康(07:10 完成)— 全部通過,無需變更:**
- echarts 確實獨立 async chunk(GgChart-*.js,480kB raw/160kB gzip),主 entry grep echarts 0 命中
- PWA precache 正確排除 GgChart 與 sql-wasm(vite.config.ts globIgnores,有註解),runtime CacheFirst 快取(maxEntries 8、一年),precache 19 entries 共 706KB
- 前四大 chunk:sql-wasm.wasm 660kB、echarts 480kB、AnalyzerView 330kB、主 entry 157kB(gzip 分別 323/160/108/58)
- **npm outdated 全空(所有依賴已 latest)、npm audit 0 漏洞** — 前幾晚的升級已清空待辦
- chore/deps-round2 分支與 develop 完全一致,無 commit,稍後刪除

**W3b 正確性 review(07:12 完成,fix/evening-review 已合併):**
- 審了 20 檔 +1192/-111,重點:輪胎三來源運算、持久化 schema、CSS 布局修正、i18n 對齊
- **抓到並修掉 1 個真 bug(4d2f90d)**:GearPanel 是長駐元件,在檔案 A 倒算周長後切到檔案 B,結果訊息不會清除 — 顯示的是舊檔案算出的值,誤導性強;修法是 watch session 變動即清除
- 核實無誤:規格 regex 容錯(含 `180/55ZR17 73W` 實測)、倒算單位換算手算一致、T5 新 storage key 舊資料 fallback 正確、i18n 六個新 key 兩語系對齊
- 低信心觀察(未動,留意即可):GearPanel 其他 ref 是否也有類似殘留未逐一排查;AnalyzerView 的 reconcileLayout 與三個 storage blob 對照邏輯未逐行深挖;元件層 reactive 接線目前無自動化測試基礎設施(repo 慣例是邏輯下沉,可考慮日後補 component 測試骨架)

**7/7 晨追加排查(07:38 完成)— 上面兩個低信心項已收掉,全部乾淨:**
- GearPanel 全狀態分類:真正的 ref 只有已修的 estimateResult/estimateFailed 兩個,其餘都是 computed(天然跟隨 session)或刻意持久化的車輛設定;AccelTestPanel 無殘留風險
- reconcileLayout 四檢查點全過:孤兒 id 有濾除(含測試)、三個 blob 同步讀取無競態、nextId 單調遞增不撞號、f0b53b9 舊資料升級路徑正確(無 key fallback 預設、空陣列保留清空狀態)
- 唯一記錄未修的邊角:移除檔案後 SessionMerge 下拉殘留失效 id — null-guard 齊全、按鈕正確停用、不產生錯誤數據,屬 UI 磨光項

### 4.5 今晨自動視覺驗收結果(08:07)
- **PASS**:空狀態文字三種視窗尺寸(手機/平板/桌面)皆無裁切;全程 console 零錯誤/警告
- **BLOCKED(需要你實機測)**:T1 卡片內圖例/T3 XY 縮放/T5 持久化/T2 輪胎 UI — 自動化注入 .loga 到 dev server 不穩定(Vite 對 public 下 .loga/.nmea 回退 SPA fallback,偶發成功那次 superX.loga 還解析失敗),所以卡片級驗證得靠你用「載入記錄」手動選檔走一輪
- 順帶發現兩個之後可查的小怪事:①Vite dev 對 public/ 非常規副檔名的 SPA fallback 行為 ②superX.loga fixture 經瀏覽器注入時解析失敗的原因

### 5. 未完成 / 等你決定
- Cloud-track §8 決策(repo/授權/CDN/OAuth)— 依你指示跳過,等你拍板
- G-G bundle split 已是既有功能;echarts chunk 的 build 實證見 W3a 報告
- 昨晚三次 agent「轉派鏈」異常浪費了些 token,教訓已寫入記憶(prompt 加反轉派條款)

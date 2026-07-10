# 雲端賽道庫方案比較報告（GitHub vs Firebase vs Cloudflare vs Supabase）

> 背景：[`CLOUD-TRACK-DESIGN.md`](./CLOUD-TRACK-DESIGN.md) §8 於 2026-07-07 白天已就「GitHub repo +
> jsDelivr CDN + PR 貢獻流程」拍板。同日晚間使用者重新考慮「git repo 是不是最佳解？有沒有更好的免費方案
> （例如 Firebase）？」，故暫緩建 repo，先產出本報告重新比較，供使用者回來後二次拍板。
> 本文**不護航現方案**——若研究結果指向其他方案更好，會直接說。
> 最後更新：2026-07-08。查證日期：2026-07-08（各平台免費額度以官方文件為準，見各節引註）。

## 目前程式碼的整合現況（先講清楚「已經卡在哪」）

`src/stores/trackLibraryStore.ts` 目前只有 bundled seed snapshot
（`SEED_TRACK_LIBRARY`，`src/domain/tracks/seedLibrary.ts`），還沒有任何 runtime 抓取邏輯——
store 的註解明講：之後不管接哪個來源，都只是新增一個 `mergeFetched`-style action 把驗證過的
`TrackDefinitionV1[]` push 進 `tracks`，**呼叫端完全不用改**。這代表「選哪個雲端方案」對現有
`src/domain/tracks/schema.ts`（394 行，schema + 驗證）、`contribute.ts`（PR 草稿產生）、
`TrackFilePanel.vue`（手動匯出/匯入）**幾乎零影響**——這四個方案的差異幾乎全部集中在
**「資料放哪、怎麼審、怎麼抓」**這三件事，不影響已經寫好的 schema/比對/UI 層。這一點很重要：
不管本文最終建議什麼，都不是要重寫現有程式碼，只是決定一個目前還是空的「抓取來源」。

---

## 方案 1：GitHub repo + jsDelivr（現方案，§8 已拍板但重新檢視）

**運作方式**：獨立 `track-log-studio-tracks` repo 存放 JSON，社群以 PR 貢獻，CI（schema 驗證 +
幾何合理性檢查）+ 人工 review 後合併；app 背景向 `cdn.jsdelivr.net/gh/...` 抓增量更新，
build 時 bundle 一份 pinned snapshot 保證離線可用。完整設計見 CLOUD-TRACK-DESIGN.md §1–§4。

| 面向 | 評估 |
|---|---|
| **免費額度與超額風險** | GitHub repo 本身無額度上限（公開 repo 免費、無限流量）；jsDelivr 官方聲明 API **無 rate limit**（大量長期使用建議先聯繫）；就算改走 `raw.githubusercontent.com`，2025-05 起未認證請求限制約每 IP 每小時 5000 次（[GitHub Changelog](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)）。對這個量級的個人專案，**幾乎不可能碰到額度上限**，是四個方案裡風險最低的。 |
| **貢獻/審核流程** | **這是本方案唯一無可取代的優勢**：PR = diff review，任何人一眼就能看出「新增了什麼欄位」；CI 自動擋 schema 錯誤/幾何不合理值；垃圾/惡意資料在合併前就被人工 review 攔下，**且 review 動作本身不需要額外寫任何後端程式**（GitHub 內建）。四個方案裡只有這個有現成的「送審」介面。 |
| **維運成本** | 需要維護一個獨立 repo（issue/PR 通知、CI workflow）+ schema 驗證腳本（用 `ajv`，Node 內建工具鏈，不需另外的服務）。**不需要寫任何自訂後端**——沒有 API server、沒有資料庫要顧、沒有身分驗證系統。 |
| **離線/PWA 相容** | 天然相容。「bundle snapshot（build 時 pin git tag）+ runtime 增量更新（背景 fetch，失敗靜默略過）」正是為 PWA 離線優先設計的既有方案（§3.2），已經考慮過完整性/pin 策略。 |
| **資料授權與可攜性** | **最佳**。CC0 JSON 檔案本身就是最終產物，`git clone` 就是完整備份，任何人可以整包下載、fork、轉存到別的平台，沒有「資料被關在某個 API/SDK 後面」的問題——這對 CC0 精神（公眾領域、最大自由）而言是最一致的形式。 |
| **與現有架構整合工作量** | 中：需要新建 repo + CI + schema 驗證腳本 + `contribute.ts` 已經寫好一半（PR 草稿產生），app 端只差一個 fetch client（`trackLibraryStore.mergeFetched`）。CLOUD-TRACK-DESIGN.md 已經把整個設計都寫完，等於「照抄現成設計動工」。 |

---

## 方案 2：Firebase（Firestore 或 Realtime Database）

**運作方式**：track 資料存進 Firestore/RTDB collection，app 用 Firebase JS SDK 直接讀（走安全規則
限制唯讀），社群提交走一個「送審 collection」+ Cloud Functions/後台審核後搬進正式 collection。

| 面向 | 評估 |
|---|---|
| **免費額度與超額風險** | Spark（免費）方案：Firestore 1 GB 儲存、**每日** 5 萬次讀取、2 萬次寫入、2 萬次刪除（超過當日額度即開始計費，不是直接擋掉）（[Firebase 官方文件](https://firebase.google.com/docs/firestore/quotas)）。對這個專案的流量而言額度本身夠用，但**若要做審核用的 Cloud Functions（見下），Google 規定必須升級到 Blaze（隨用隨付）方案並綁定信用卡**，即使實際用量仍落在免費額度內、不會被扣款（[Firebase 定價文件](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)）——這是一個「免費但要先押信用卡」的隱性門檻，且有失控扣款的心理風險（規則寫錯導致無限迴圈讀寫）。 |
| **貢獻/審核流程** | **這是本方案最大的弱點**：Firebase 沒有「PR diff review」這種東西。要做到「社群提交→人工審核→正式上架」，必須自己蓋一整套：(a) 一個公開可寫的「待審 collection」+ 安全規則防注入/防洗版（還要考慮 App Check 防機器人濫寫）、(b) 一個管理員才能看到的審核介面（要嘛用 Firebase Console 手動看 JSON 心智負擔很重，要嘛自己寫一個管理頁面）、(c) 核准後把資料從待審搬到正式 collection 的邏輯（用 Cloud Functions，需要 Blaze）。等於**把 GitHub 免費附贈的整套 code-review UI 重新造一次輪子**。 |
| **維運成本** | 高：至少要寫安全規則（Firestore Security Rules，一種獨立的 DSL，有學習成本）、審核用的 Cloud Function 或管理頁面、防濫用機制（rate limit、App Check）。**這些現在都不存在，且沒有比 GitHub PR 更省事的等價物**。 |
| **離線/PWA 相容** | Firestore SDK 本身有離線快取層，但那是「快取『使用者連線時看過的資料』」，不是「build 時 bundle 一份離線 snapshot」的語意——要做到本專案要的「無網路也能首次 A2 自動套用」，仍然得自己維護一份 bundle-at-build 的靜態快照（等於重造 §3.2 的 bundled snapshot 那一半），Firestore 只能取代 §3.2 的「runtime 增量更新」那一半，且要多引入 `firebase` SDK（打包體積增加，需評估 tree-shaking 後實際大小）。 |
| **資料授權與可攜性** | 較差：CC0 資料存在 Firestore 裡，要「整包匯出」得寫匯出腳本（`gcloud firestore export` 或逐筆讀取），不像 git repo 那樣「`git clone` 就是全部」。對外部想重用這批 CC0 資料的第三方（例如另一個賽道分析工具想直接用同一批資料）而言，得先申請 Firebase API key 或走匯出流程，摩擦力比公開 git repo 高，某種程度上違背 CC0「開放到任何人都能直接拿」的精神。 |
| **與現有架構整合工作量** | 高：新增一個完全陌生的 vendor（目前專案沒有任何 Google Cloud/Firebase 依賴）、新的 SDK、新的安全規則語言、新的審核後台要從零生出。是四個方案中整合成本最高的。 |

---

## 方案 3：Cloudflare Workers KV / R2 / D1 + Worker API

**運作方式**：track 資料放進 Cloudflare KV（或 R2 存 JSON 檔、D1 存關聯式資料，但本案資料形狀簡單不需要
關聯查詢，KV 最貼近需求），由一個 Worker 提供讀取端點；社群貢獻仍然可以（也建議）走 GitHub PR，
merge 後用 GitHub Action + `wrangler` 把驗證過的資料寫進 KV/R2，app 改成向自家 Worker 網域抓資料
而不是 jsDelivr。**關鍵背景**：本專案已經部署在 Cloudflare Workers（`track-log-studio.timliudev.workers.dev`），
帳號、`wrangler` OAuth、CI 部署流程都已經存在——這是本方案相較 Firebase/Supabase 的決定性加分。

| 面向 | 評估 |
|---|---|
| **免費額度與超額風險** | Workers Free 方案：每日 **10 萬次請求**（[Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)）；KV 免費層：1 GB 儲存、每日 10 萬次讀取、1000 次寫入；R2 免費層：10 GB-月儲存、每月 100 萬次 Class A operation、1000 萬次 Class B operation、**零 egress 費用**；D1 免費層：5 GB 儲存、每日 500 萬次列讀取、10 萬次列寫入（[Cloudflare KV/R2 Pricing](https://developers.cloudflare.com/kv/platform/pricing/)）。對賽道庫這種讀多寫極少（社群 PR 頻率低）的場景，**免費額度綽綽有餘**，超額風險與方案 1 同級（幾乎不可能）。唯一要注意的摩擦：**啟用 R2 官方仍要求綁信用卡**才能開通（即使停留在免費額度內不扣款），KV/D1 在既有 Workers 帳號下則不需要額外操作——由於帳號已存在，這點摩擦力對本專案而言已經沉沒（不是新增門檻）。 |
| **貢獻/審核流程** | **可以直接沿用方案 1 的 GitHub PR + CI + 人工 review**——這不是二選一，而是「資料來源審核」與「資料分發位置」可以拆開決定。也就是說本方案不必犧牲方案 1 唯一的優勢；只是把「app 去哪裡抓資料」從 jsDelivr 換成自家 Worker。若真的想做「不經過 GitHub 的直接送審」，Worker 也可以另外做一個送審 API + KV 佇列，但**不是必要**，建議不做，直接沿用 PR 流程即可。 |
| **維運成本** | 低到中：如果採「GitHub PR 審核 + Worker 只當唯讀分發層」，維運成本幾乎等同方案 1，只多一步「GitHub Action 用 `wrangler kv key put` / `wrangler r2 object put` 把資料同步進 KV/R2」（幾十行 CI script）；不需要自己的資料庫使用者管理、不需要新的安全規則語言（Worker 本身就是我們寫的 TS，複用現有技能）。 |
| **離線/PWA 相容** | 與方案 1 完全相同的相容性——bundle-at-build snapshot（不受影響，來源是 build 時 pin 的 git tag，與分發層無關）+ runtime 向自家 Worker 背景抓增量更新（fetch 失敗一樣靜默略過）。**唯一差異只是 runtime fetch 的 URL 從 `cdn.jsdelivr.net` 換成 `track-log-studio.timliudev.workers.dev/api/tracks/...`**，程式碼改動幅度极小（`trackLibraryStore` 的 fetch client 換一個 base URL）。 |
| **資料授權與可攜性** | 與方案 1 相同（**最佳**）：真正的資料來源（source of truth）仍是公開 GitHub repo 的 JSON 檔案，`git clone` 就是完整備份，CC0 授權宣告在 repo 的 LICENSE。Worker/KV 只是「分發快取層」，不是資料真正存放的唯一副本——即使哪天不想用 Cloudflare 了，資料本身完全不受影響，直接切回 jsDelivr 或任何其他 CDN 都可以。**沒有平台綁架風險**，因為 KV/R2 裡的內容本質上是可丟棄、可重新產生的衍生物（build artifact），不是唯一真本。 |
| **與現有架構整合工作量** | **最低**：不引入任何新 vendor（帳號、OAuth、部署流程全部已經存在且在用）；不需要新 SDK（`fetch()` 打自家網域即可，連 Cloudflare 的任何客戶端函式庫都不必裝）；Worker 程式碼用專案已經熟悉的 TypeScript 寫。這是四個方案裡「多一個服務要顧」成本最低的——某種意義上根本不算「多一個服務」，只是既有 Worker 多掛兩個路由。 |

---

## 方案 4：Supabase（Postgres + 自動生成 REST/Realtime API）

**運作方式**：track 資料存進 Supabase 的 Postgres 表，用 Supabase 自動產生的 REST API（PostgREST）
或 client SDK 讀取，Row Level Security（RLS）限制唯讀；審核流程與 Firebase 同樣得自建
「待審表 + 審核介面 + 核准後搬移」的機制。

| 面向 | 評估 |
|---|---|
| **免費額度與超額風險** | 免費層：500 MB 資料庫（含索引）、1 GB 檔案儲存、5 GB egress、最多 2 個 active 專案（[Supabase Pricing](https://supabase.com/pricing)）。額度本身對這個資料量（賽道 JSON，單筆幾 KB）綽綽有餘。**但有一個對本案是致命傷的限制**：**免費專案連續 7 天無 API 請求會自動暫停**（資料不會丟，但專案離線直到手動喚醒）（[Supabase 免費層說明](https://www.itpathsolutions.com/supabase-free-tier-limits)）。本方案的 runtime 抓取被設計成「背景、低頻、失敗靜默略過」的錦上添花更新——這代表**真實使用場景很可能長時間沒人觸發請求**，專案會被自動暫停，下次有人真的需要抓新賽道時，第一個請求會打到一個暫停中的專案（等於功能悄悄失效，且不會有明顯錯誤訊息提示是「專案睡著了」而非「網路問題」），必須另外做一個保活機制（例如排程 ping）——這又是一筆額外維運負擔且仍可能踩到「2 個 active 專案」上限（若之後還有其他用途）。 |
| **貢獻/審核流程** | 與 Firebase 同樣的弱點：沒有 PR-diff-review 這種現成介面。要做「送審→人工核准→上架」一樣得自己蓋：RLS 規則設計、審核用的介面或後台、核准後的資料搬移邏輯（可以用 Supabase Edge Functions，但一樣是要自己寫的程式碼，沒有 GitHub PR 那種「開箱即用」的體驗）。 |
| **維運成本** | 高：要學 RLS（Postgres 原生機制，比 Firestore 規則更接近 SQL 但仍是新東西）、要處理上述的自動暫停/保活問題、Postgres schema migration 要自己管理版本。 |
| **離線/PWA 相容** | 與 Firebase 類似：Supabase 沒有內建「build 時 bundle 離線 snapshot」的機制，一樣得自己維護 bundle-at-build 那一半，Supabase 只能取代 runtime 增量更新那一半，還要多引入 `@supabase/supabase-js`（增加 bundle 體積）。 |
| **資料授權與可攜性** | 較差，理由同 Firebase：資料要「整包下載」得寫匯出腳本（`pg_dump` 或逐表 REST 查詢），不像 git repo 天然可整包複製；對想重用這批 CC0 資料的第三方而言摩擦力比公開 git repo 高。 |
| **與現有架構整合工作量** | 高：全新 vendor、全新 Postgres/RLS 心智模型、全新 SDK，且自動暫停問題需要額外解法。是四個方案中「維運驚喜最多」的一個。 |

---

## 四方案總覽

| | GitHub+jsDelivr | Firebase | Cloudflare KV/R2+Worker | Supabase |
|---|---|---|---|---|
| 免費額度風險 | 極低 | 低（但 Cloud Functions 要押卡） | 極低 | 低（但**會自動暫停**） |
| 社群審核流程 | ✅ PR 內建 | ❌ 要自建整套 | ✅ 沿用 PR（分發層與審核層拆開） | ❌ 要自建整套 |
| 需要自寫後端 | 否 | 是（Cloud Functions） | 否（Worker 只當唯讀分發，可選） | 是（Edge Functions） |
| 離線 bundle snapshot | 天然相容 | 需另外維護 | 天然相容（不變） | 需另外維護 |
| CC0 資料可攜性 | 最佳（git clone） | 較差（需匯出腳本） | 最佳（同左，來源仍是 git） | 較差（需匯出腳本） |
| 新增 vendor/帳號 | 否（複用 GitHub） | 是，全新 | 否（複用既有 Cloudflare 帳號） | 是，全新 |
| 整合工作量 | 中（照抄既有設計動工） | 高 | **最低** | 高 |

---

## 結論與建議

**建議：混合方案 —— 貢獻/審核層維持 GitHub PR 不變，分發層從 jsDelivr 換成 Cloudflare Worker + KV。**

**一句話理由**：GitHub PR 是四個方案裡唯一「免費、零額外程式碼」就能做到人工 diff review 的
貢獻/審核機制，沒有理由放棄；但本專案已經在 Cloudflare 上有部署帳號與 CI/CD 流程，把分發層從
「跟專案完全無關的第三方 jsDelivr」換成「自家已經在付費/免費使用的 Cloudflare KV」，幾乎零額外
整合成本（帳號已有、免綁新卡、免學新 SDK），還換來「資料分發在自己掌控的網域下」的好處
（可視需要加自訂快取策略、之後想做審核佇列 API 也在同一個 Worker 上擴充即可），是純加分、
幾乎沒有代價的改動。**Firebase 與 Supabase 兩者都不建議**：兩者都無法提供 PR-diff-review
等級的免費審核機制（等於要重新造一輪管理後台），都會新增一個與專案現有技術棧無關的 vendor，
且都有各自的隱性摩擦（Firebase Cloud Functions 要押信用卡；Supabase 免費專案 7 天無請求會
自動暫停，恰好命中本案「背景低頻抓取」的使用模式，是實際的可靠性風險而非理論疑慮）。

### 若維持「純 GitHub + jsDelivr」（不採本文建議、原方案照舊）——下一步清單
1. 建立 `track-log-studio-tracks` repo（CC0-1.0 授權、schema/CI，見 CLOUD-TRACK-DESIGN.md §2）。
2. 撰寫 `schema/track.schema.json` + `validate.yml`（ajv 驗證 + 幾何合理性檢查，見 §2.3）。
3. 使用者提供首波種子賽道清單（§8 決策 4，待補）。
4. `trackLibraryStore` 新增 `mergeFetched` action，fetch client 指向
   `cdn.jsdelivr.net/gh/<org>/track-log-studio-tracks@main/tracks/index.json`。
5. 加上應用層 hash 校驗（§3.3）與 pin 策略（build 時 pin tag，runtime 依 §8 決策 3 跟 `@main`）。

### 若採本文建議「GitHub PR 審核 + Cloudflare 分發」——下一步清單
1. 前 3 步與上面完全相同（repo/schema/CI/種子賽道不變——這部分本來就不受分發層影響）。
2. 在既有 Cloudflare Worker 專案新增一個 KV namespace（如 `TRACK_LIBRARY`），或視資料量改用
   R2（此案資料量小，KV 更貼合，且免多綁卡）。
3. 在 `track-log-studio-tracks` repo 加一個 GitHub Action：PR 合併到 `main` 後，用既有
   `wrangler` OAuth 憑證跑 `wrangler kv key put`，把 `tracks/index.json` 與各賽道 JSON
   同步寫入 KV。
4. 在主 app 的 Worker 上新增兩個唯讀路由（如 `/api/tracks/index.json`、
   `/api/tracks/:id.json`），從 KV 讀出後回應（設定合理 `Cache-Control` 走 Cloudflare edge cache）。
5. `trackLibraryStore` 的 `mergeFetched` fetch client 指向自家網域的上述路由，取代 jsDelivr URL；
   其餘（bundle snapshot、應用層 hash 校驗、比對/優先序邏輯）完全不變。
6. （可選、非必要）之後若想要「不經 GitHub PR 的直接投稿表單」，可以在同一個 Worker 上加一個
   寫入 KV 待審佇列的 API，但建議先不做——PR 流程已經夠用，過早加這層只是徒增維運面。

---

## 查證來源

- jsDelivr 無 rate limit 聲明、GitHub 2025-05 未認證請求限制、jsDelivr 7 天快取：已列於
  `CLOUD-TRACK-DESIGN.md` §3.1，本文不重複列出。
- [Firebase Firestore Usage and Limits（Spark 免費層每日額度）](https://firebase.google.com/docs/firestore/quotas)
- [Firebase Pricing Plans（Blaze 方案需要綁定帳單但免費額度內不收費）](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Cloudflare Workers Limits（Free 方案每日 10 萬次請求）](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare KV Pricing（KV 免費層額度）](https://developers.cloudflare.com/kv/platform/pricing/)
- [Cloudflare R2 免費層需要綁卡才能啟用的社群討論](https://community.cloudflare.com/t/question-regarding-5-usd-charge-for-r2-storage-activation/900480)
- [Supabase Pricing（免費層額度總覽）](https://supabase.com/pricing)
- [Supabase 免費層「7 天無請求自動暫停」說明](https://www.itpathsolutions.com/supabase-free-tier-limits)

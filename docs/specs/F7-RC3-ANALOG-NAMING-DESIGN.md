# F7 — RC3 Analog 自訂命名表 設計草案

> **狀態：draft，待 user 拍板 UX 與 schema；拍板前不實作。**
> 本文件只整理問題、現況與可選方案，**不代表任何已定案的決策**。文中的「建議」一律是撰稿者的
> 意見，不是拍板結果。
>
> 對應追蹤條目：`docs/ISSUES.md` 的 **F7**（以及相鄰的 **B120–B127**）。
> 格式背景：[`RCZ-FORMAT-SPEC.md`](./RCZ-FORMAT-SPEC.md) §5.3 與 §10 附錄（實測值域）。
> 撰寫日期：2026-08-21

---

## 1. 問題陳述

RaceChrono 的 `.rcz` 檔**內部沒有任何頻道文字標籤**。整個 ZIP（`session.json` /
`sessionfragment.json` / `trackId.json` / `channel_*`）裡只有**數字 channel id** 與 device
`id`/`model`/`type`，沒有一處存放頻道名稱、單位或說明（見 RCZ-FORMAT-SPEC §5.3）。

RC3 資料裝置送進來的槽位是固定編號的：

| 槽位 | 語意來源 | 匯入後的頻道名 |
| --- | --- | --- |
| d1 | **固定 = 引擎轉速**（RaceChrono `$RC3` 的硬性語意，B121） | `rc_rpm` |
| d2 | **使用者自訂** | `rc_digital_2` |
| a1–a15 | **使用者自訂** | `rc_analog_1` … `rc_analog_15` |

「a3 是水溫、a5 是電瓶電壓、d2 是節氣門開度」這種語意**只存在使用者自己的 RaceChrono／ECU
設定裡**，檔案端無從得知。於是：

- **匯入顯示**：頻道清單、圖表圖例、目前數值卡通通只能顯示 `rc_analog_5` 這種代號。
- **匯出欄名**：`_ct.vbo` 的欄名、`_channels.csv` 的對照表、通用 `.csv` 的標題列同樣只有代號，
  拿進 Circuit Tools／Excel 一樣看不懂。
- **單位也一起缺**：這些槽位在 importer 端沒有可靠的物理單位（`int32ScaleFor` 對 RC3 bank 沒有
  已驗證的單位），匯出時只能落 `raw`（B123 之後至少不會再把有單位的頻道洗掉，但這批本來就沒有）。

這是 **B120–B126 全部修完之後剩下的唯一一類「名字看不懂」**。B120–B126 解決的是「程式自己把名字
搞錯／撞號／單位洗掉」；F7 要解決的是「程式**根本沒有**這個資訊」——差別很重要：前者是 bug，
後者只能靠**使用者輸入**補上，任何自動推測都是臆測（見 §8）。

---

## 2. 設計目標 / 非目標

### 目標

1. 使用者能建立一張「**槽位 → 真名（含單位）**」對應表，例如 `rc_analog_5` → `電瓶電壓 (V)`。
2. 這張表能**存成 preset**、**隨裝置記憶**（localStorage），下次匯入同一台車的 `.rcz` 直接套用，
   不必重打。
3. 支援**多個 preset**（不同車／不同 ECU 配置／不同接線），可指定預設 preset。
4. 套用後，**匯入顯示**與**匯出欄名**都用真名（匯出的例外見 §6.3——`_rc.vbo` 的 `rc_` 識別符欄
   有格式硬性約束，不能換）。

### 非目標（本設計刻意不碰）

- 不猜測、不自動命名（§8）。
- 不改動 `.loga` / `.nmea` / `.vbo` / `.xrk` / `.rcnx` / `.csv` 等其他格式的命名流程（§8）。
- 不做雲端同步／跨裝置共享（若日後要，走既有的 `exportMetadata` 可攜註記或雲端備份路線，屬另案；
  可否納入見 §9 開放問題 7）。

---

## 3. 現況：名字從哪來、流到哪去

拍板前先把現有路徑講清楚，因為「要在哪一層插入命名」是本設計最關鍵的取捨（§6）。

```
.rcz bytes
  └─ parseRczCore.ts  ── decodeRcChannelName(id) / rc3ChannelName(id)
        id 20003..20007 → 'rc_analog_1'..'rc_analog_5'
        id 20011..20020 → 'rc_analog_6'..'rc_analog_15'
        id 20002        → 'rc_digital_1'（→ 匯出端再認成 rc_rpm，B121）
        id 20010        → 'rc_digital_2'
     ↓  產生 Channel { name, rawName, description?, unit?, data }
  └─ LogSession（byName Map + aliasCandidates 的別名解析）
     ├─ UI 顯示：各卡片／圖表直接讀 channel.name（＋ description）
     └─ 匯出：
         ├─ VboExporter.buildVboCatalog(session)
         │    ├─ ctTitle = channel.name         → `_ct.vbo` 欄名、`_channels.csv` 的 ECU 欄
         │    ├─ rcName  = rc_ 識別符           → `_rc.vbo` 欄名 + 內嵌 channel map
         │    │    · 名稱已是合法 rc_ 識別符 → identity 直通（B120）
         │    │    · 否則丟進 analog/digital generic bucket 重新編號
         │    └─ unit    = channel.unit || 'raw'（B123）
         ├─ convertToCsv                        → `.csv` 標題列用 channel.name
         └─ Rc3NmeaExporter + mapping.ts        → 使用者指派 d2 / a1..a15（d1 固定 RPM）
```

**單一真實來源**：`rc_` 識別符集合在 `src/domain/raceChrono/identifiers.ts`，匯入
（`decodeRcChannelName`）與匯出（`buildVboCatalog` 的 identity 直通判斷）共用同一份表（B120）。
任何命名機制都必須尊重這份表，否則 B120 會回歸。

---

## 4. 資料模型提案（localStorage schema）

沿用本 repo 的既有慣例：`tracklogstudio.*` 前綴、**版本化 key**（`….v1`）、**純函式核心 +
薄 storage 殼**、**sanitize-on-load**（比照 `cardVisibility.ts` / `featureFlags.ts` /
`panelState.ts`；CVT profile sanitizer 的長度／範圍夾限則是 M9 的資安要求）。

**Storage key（提案）**：`tracklogstudio.rc3ChannelNames.v1`

```ts
/** 一個槽位的使用者命名。 */
export interface Rc3SlotName {
  /** 槽位 id ＝ importer 產生的頻道名（穩定機器鍵，永不改動）。
   *  白名單：'rc_analog_1'…'rc_analog_15'、'rc_digital_2'。
   *  ⚠️ 'rc_digital_1' / 'rc_rpm' 是格式固定語意（B121），不開放命名。 */
  slot: string
  /** 顯示名，例如 '電瓶電壓'。空字串＝清除此槽命名（退回代號）。 */
  label: string
  /** 單位，例如 'V' / '°C' / '%'。選填。 */
  unit?: string
  /** 使用者備註（接線位置、感測器型號…）。選填，僅供人看，不進匯出。 */
  note?: string
}

/** 一組配置（一台車／一種 ECU 接線）。 */
export interface Rc3NamingPreset {
  /** 穩定 id（建立時產生；本 repo 既有作法是 `crypto.randomUUID()`，見 `useMapBackground.ts`）。 */
  id: string
  /** 使用者取的 preset 名稱，例如 'CB650R + 外掛 ECU'。 */
  name: string
  slots: Rc3SlotName[]
  createdAt?: number
  updatedAt?: number
  /** 選配：自動比對線索（見 §9 開放問題 2）。留空＝永遠手動選。 */
  matchHint?: {
    /** sessionfragment.json 的 devices[].model（本樣本 RC3 裝置為 404）。 */
    deviceModel?: number
  }
}

/** 持久化的整包。 */
export interface Rc3NamingStore {
  version: 1
  presets: Rc3NamingPreset[]
  /** 匯入時預設套用哪一個；null ＝ 不自動套用。 */
  defaultPresetId: string | null
}
```

### 4.1 sanitize-on-load 規則（提案）

比照既有 sanitizer 的嚴格度，載入時**不信任任何持久化內容**：

- 非物件／`JSON.parse` 失敗／`version` 不是 1 → 整包退回空預設（不嘗試猜測式遷移）。
- `slot` 必須落在**白名單**（`rc_analog_1..15` ＋ `rc_digital_2`）；不在的直接丟棄。
  同一 preset 內 `slot` 重複時取第一筆。
- `label` / `unit` / `note` 必須是 `string`，**trim** 後套長度上限（提案：label 64、unit 16、
  note 200 字元），超長截斷。
- 數量上限（提案）：presets ≤ 32、每 preset slots ≤ 16（槽位總數本來就只有 16 個）。
- `defaultPresetId` 指向不存在的 preset → 視為 `null`。
- **匯出前的字串安全**：使用者名稱會流進 `.csv` / `_channels.csv` 的欄位，必須繼續走既有的
  **OWASP 公式注入中和**（前導 `'`，M9 已為 CVT 筆記／頻道名稱建立此防護）與 CSV 逸出；
  另需擋掉會破壞 VBO `[column names]` 語法的字元（空白／換行／`,`）——見 §6.3。

---

## 5. UX 選項（**待 user 拍板，本文件不代表決策**）

### 選項 A — Settings 頁新增「RC3 命名表」編輯器

在設定頁開一區，列出 16 個槽位的表格，逐列填名稱／單位／備註，上方是 preset 下拉（新增／複製／
刪除／設為預設）。

- ✅ 集中管理、preset 生命週期清楚；不需要先匯入檔案就能先建好表。
- ✅ 實作面單純：一個純資料模組 + 一個設定頁區塊，不動分析器。
- ❌ **最大缺點：填表當下看不到任何資料**。使用者要判斷「a5 到底是不是電瓶電壓」，靠的是值域
   （0.5–14.7 V）與曲線形狀；純文字表單沒有這個脈絡，只能憑記憶或另開 RaceChrono 對照。

### 選項 B — 匯入 `.rcz` 後，在頻道清單就地改名，並「存為 preset」

匯入完成後，在既有的頻道／圖表選單裡讓 `rc_analog_*` 這些槽位可就地改名（inline edit），旁邊
顯示該頻道的實測值域（min–max）當線索；改完按「存為 preset」把整組命名收進 localStorage。

- ✅ **在唯一能判斷語意的時刻做這件事**——眼前就有數字與曲線，值域直接當佐證
   （RCZ-FORMAT-SPEC §10 附錄那張表就是這樣讀出來的）。
- ✅ 首次使用零學習成本：看到看不懂的名字 → 就地改掉。
- ❌ preset 的**管理**（改名、刪除、切換預設、複製一份給第二台車）塞在分析器裡會很擠。
- ❌ 沒載入檔案時無從編輯。

### 選項 C — 兩者皆做：**就地改名為主、Settings 管理 preset**

B 負責「填內容」，A 縮減為「管清單」（列出 presets、重新命名／刪除／設為預設／匯出匯入 JSON），
不做逐槽位的細部編輯。

- ✅ 各取所長：填寫在有脈絡的地方、管理在該管理的地方。
- ❌ 工作量最大（兩處 UI ＋ i18n 雙語 ＋ 兩處測試）。

### 撰稿者推薦（**僅供拍板參考**）

**推薦 C，但分兩階段落地**：

- **v1 ＝ B 的完整功能 ＋ A 的最小版**：就地改名（含值域提示）＋「存為 preset」；Settings 只放
  presets 清單與「重新命名／刪除／設為預設」三個動作。
- **v1.5（視使用情況再決定）**：Settings 內的逐槽位表格編輯、preset JSON 匯出匯入。

理由：這個功能的**成敗完全取決於使用者能不能正確認出槽位**，而唯一有判斷依據的時刻就是資料在眼前
的時候；把填寫入口放在 Settings（選項 A）等於要求使用者先在別處查好答案再回來抄，實務上多半就
不會用了。反過來，preset 的清單管理是低頻操作，塞在分析器裡只會擋路，所以那半留在 Settings。
單做 B 而完全沒有管理入口，則會出現「preset 只能新增不能刪」的死路。

---

## 6. 套用時機與範圍

這是本設計**技術上最關鍵**的取捨，也直接影響 B120 會不會回歸。

### 6.1 方案一：匯入期改名（把 `Channel.name` 直接換成使用者的名字）

在 `parseRczCore` 之後、`LogSession` 建立之前（或 rebuild 時）就把 `rc_analog_5` 改成
`電瓶電壓`。

- ✅ 下游（UI、所有 exporter、`byName` 查表）**全部零改動**就吃到新名字。
- ❌ **會打破 B120 的 identity 直通**：`buildVboCatalog` 靠 `isRcIdentifier(name)` 判斷「這個名字
   已經是合法 `rc_` 識別符 → 原樣直通並向 Allocator 登記槽位」。名字一旦被換成中文，這條判斷就
   false，該頻道會掉進 generic bucket 被**重新編號**——正是 B120 修掉的那個 bug 的形狀。
- ❌ **匯出欄名不再穩定**：同一場資料，套不套 preset 會產出不同的 `_rc.vbo` 槽位號碼。
- ❌ **污染快取／已匯入 session**：已經在畫面上的 session 是改名前的名字，preset 一改要不要重解析？
- ❌ **golden fixture 風險**：`.loga` 路徑雖然不受影響（沒有 `rc_*` 槽位），但 `.rcz` 的 fixture
   會隨「當下 localStorage 有沒有 preset」而變——測試不該依賴使用者偏好。

### 6.2 方案二：顯示期映射（`Channel.name` 保持代號，另加一層 label）

`Channel.name` 永遠是 `rc_analog_5`（穩定機器鍵、`identifiers.ts` 的語彙不變），另外提供
`displayLabelFor(channelName)`，由 UI 與**選定的** exporter 在輸出當下查表。

- ✅ B120 的 identity 直通、`_rc.vbo` 槽位編號、`byName` / `aliasCandidates` 解析全部不受影響。
- ✅ 對**已匯入的 session** 立即生效（換 preset ＝ 換一層 label，不必重新解析檔案）。
- ✅ golden fixture 只要不注入 preset 就與現況位元相同；要測命名時明確餵一個 preset 進去。
- ❌ 需要逐一決定「哪些顯示點／哪些匯出欄要吃 label」，改動點比方案一分散。
- ❌ 使用者可能期待「改了名字，`.csv` 裡就是那個名字」——若某些輸出刻意不換，要在 UI 講清楚。

### 6.3 匯出欄名的分層（兩種方案都適用）

**`_rc.vbo` 的 `rc_` 識別符欄不能換成自訂名字**——那欄的消費者是 RaceChrono，只認識
`identifiers.ts` 那組識別符與 `rc_analog_N` 這種編號槽位。可以換的是「給人看」的那幾個出口：

| 輸出 | 欄名來源 | 可否用自訂名 |
| --- | --- | --- |
| `_rc.vbo`（RaceChrono） | `rcName`（`rc_` 識別符） | ❌ **不可**，格式硬性約束 |
| `_rc.vbo` 內嵌 channel map | 識別符 ↔ 說明 | ⚠️ 說明欄可考慮帶自訂名（待查證 RaceChrono 的容忍度） |
| `_ct.vbo`（Circuit Tools） | `ctTitle` ＝ `channel.name` | ✅ 可 |
| `_channels.csv` 對照表 | ECU 欄 ＋ 說明欄 | ✅ 可（建議兩者並列：代號 ＋ 自訂名） |
| 通用 `.csv` | 標題列 ＝ `channel.name` | ✅ 可 |
| `.nmea`（RC3） | `mapping.ts` 的 a1..a15/d2 指派 | ❌ 槽位號碼本身就是協定 |

另外，**VBO `[column names]` 是空白分隔的**，自訂名裡的空白／換行會直接破壞檔案結構；`.csv` 則
需要既有的引號逸出 ＋ 公式注入中和。因此不論採哪個方案，寫進檔案前都要過一層
`sanitizeForColumnName()`（提案：空白→`_`、剝除控制字元、非 ASCII 是否轉寫待定——見 §9 開放問題 4）。

### 6.4 撰稿者推薦（**僅供拍板參考**）

**推薦方案二（顯示期映射）**，主因是 6.1 那條「打破 B120 identity 直通」不是可控的小風險，而是
會靜默改變匯出槽位編號的回歸；且顯示期映射讓「換 preset 立刻生效、不必重新匯入」這個使用者一定會
期待的行為變成免費附送。

---

## 7. 與 B127 的交互（**開放問題，未定案**）

B127 的殘留限制是：匯出時判斷一個頻道該進 `.vbo` 的 digital 還是 analog 槽，目前只有**值域啟發式**
可用，而值域分不出「整場都沒觸發過的真數位旗標」與「值剛好恆為某常數的類比頻道」。ISSUES 裡記的
**正解方向是改吃「頻道名稱／說明文字」慣例**（`_SW` / `Malf` / `_Act` / `_En` …）。

F7 一旦落地，`rc_analog_8`（本樣本恆 9）這種頻道就可能有了使用者取的名字——於是產生一個新問題：

> **名稱慣例分類規則（B127 候選）該優先吃「使用者取的名字」，還是「原始代號」？**

兩邊都有道理，這裡**只列論點，不做結論**：

- **吃使用者名字**：使用者是唯一知道語意的人；他打了「Pit 開關」就該進數位槽。這正是 B127 想要的
  那種「名稱佐證」，而且比 ECU 慣例字樣更可靠（是人直接宣告的，不是猜的）。
- **吃原始代號**：分類結果會隨 localStorage 內容而變 → **同一個檔案在兩台裝置上匯出結果不同**，
  也讓 golden fixture 依賴使用者偏好。B125 的教訓正是「分類規則改動的爆炸半徑很難預估」。
- **第三條路（撰稿者略偏好，但同樣待拍板）**：不要讓「名字」隱含分類，而是在 F7 的 schema 裡**明確
  多一個 `kind?: 'analog' | 'digital'` 欄位**讓使用者直接選。這樣分類是**顯式宣告**而非從名字反推，
  既拿到 B127 想要的可靠佐證，又不會讓自由文字悄悄改變匯出結構。代價是 §4 的 schema 要加欄位、UI
  要多一個選擇器——**若拍板走這條，schema 需回頭修改，故本題必須與 §4 一起拍板。**

⚠️ 無論選哪條，B125 的教訓照舊適用：**任何動到分類規則的改動，都必須先報告 `.loga` golden fixture
的 diff 規模**（B125 第一版誤傷 108 個頻道就是這樣抓出來的）。

---

## 8. 不做的事

1. **不猜測任何自動命名。** 不從值域反推「a5 落在 0.5–14.7 → 一定是電瓶電壓」，也不從 RaceChrono
   的常見設定範本套預設名。RCZ-FORMAT-SPEC §10 附錄的值域表是**給使用者當線索的參考**，
   不是給程式當規則的表。理由：同一個槽位在不同車上接什麼完全自由，猜錯的成本（使用者相信了一個
   錯的名字去調車）遠高於「顯示代號」的不便。
2. **不改其他格式的命名流程。** `.loga` 的 `canonicalName`/`descriptionOf`/`ALIASES`、`.vbo` 匯入的
   欄名、`.xrk` 的 CNF/CHS channel 表、`.rcnx` 的 SQLite 欄位——全部不動。F7 的作用域嚴格限縮在
   `.rcz` 的 RC3 使用者自訂槽位（`rc_analog_1..15` ＋ `rc_digital_2`）。
3. **不動 `rc_digital_1` / `rc_rpm`。** 那是 `$RC3` 的固定語意（B121），不是使用者槽位。
4. **不做自動 preset 比對的猜測式 fallback。** 若拍板要自動比對（§9 開放問題 2），比對不到就是不
   套用，不做「反正只有一個 preset 就套上去」這種便利式猜測。

---

## 9. 待 user 拍板的開放問題

1. **UX 走 A / B / C 哪一案？**（§5；撰稿者推薦 C 分兩階段）
2. **preset 如何對上一場匯入？** 純手動選？還是用 `sessionfragment.json` 的 `devices[].model`
   （本樣本 RC3 裝置 model ＝ 404）當 `matchHint` 自動比對？——model 只有幾個代碼、很可能撞號，
   自動比對的誤套風險需評估。
3. **套用時機走 §6.1 匯入期改名還是 §6.2 顯示期映射？**（撰稿者推薦 §6.2）
4. **匯出欄名的落地細節**：`_ct.vbo` / `_channels.csv` / `.csv` 三個出口是否都換成自訂名？
   `_channels.csv` 要不要**代號與自訂名並列**？非 ASCII（中文）欄名在 Circuit Tools 的相容性
   需不需要先實測，或一律轉寫成 ASCII？
5. **B127 的分類規則吃使用者名字、吃原始代號、還是改用顯式 `kind` 欄位？**（§7；此題會回頭改
   §4 的 schema，必須與 schema 一起拍板）
6. **命名表要不要能匯出／匯入 JSON**（換手機、備份）？若要，是 v1 還是 v1.5？
7. **要不要把命名寫進 `exportMetadata`（`TLS_Metadata` 可攜註記）**，讓匯出的 `.csv`/`.vbo` 再匯回
   本工具時自動帶回命名？——好處是跨裝置自動跟隨，代價是把使用者偏好寫進資料檔（既有 CVT 筆記
   已有此先例，但那是「這份資料的註記」，命名比較像「這台裝置的偏好」，語意歸屬需要拍板）。

---

## 10. 若拍板後要實作，預估的落點（**參考用，非承諾**）

- 純資料模組：`src/domain/raceChrono/channelNaming.ts`（schema、parse/sanitize、`labelFor`
  查詢；**純函式、零 localStorage 存取**，比照 `cardVisibility.ts`）。
- storage 殼 ＋ 響應式：`src/composables/useRc3ChannelNaming.ts`（比照 `useCardVisibility.ts`）。
- 顯示接點：頻道選單／圖例／目前數值卡（依 §6 拍板結果決定要不要動 exporter）。
- 匯出接點（若拍板要換欄名）：`VboExporter.ts` 的 `ctTitle` 與 `_channels.csv` 產生處、
  `convertToCsv`；`_rc.vbo` 的 `rcName` 一律不動。
- 測試：sanitizer 邊界（白名單、長度／數量上限、壞 JSON）、`labelFor` 查詢優先序、
  **`.loga` golden fixture 位元不變**、`.rcz` 匯出在「有 preset / 無 preset」兩種情況下的欄名對拍。

---

**狀態：draft，待 user 拍板 UX 與 schema；拍板前不實作。**

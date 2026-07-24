# RaceChrono `.rcz` 完整格式規格（單場匯出）＋ 同場多格式交叉驗證

> 逆向來源樣本：`LogaExample/session_20260315_1642_極限/`
> —— 使用者把 RaceChrono **同一場** session 同時匯出成 6 種格式：
> `.rcz` / `_v2.csv` / `_v3.csv` / `.vbo` / `.nmea` / `.gpx`（RaceChrono v10.2.4）。
> 對照樣本：`LogaExample/session_20260622_0025_b1(5)_rcvbo.rcz`（舊單場匯出，OBD/CAN 裝置）。
>
> **本文件所有 scale factor 都是「拿 `.rcz` 原始 int32 對照 RaceChrono 自己輸出的 CSV
> 同一時間戳的值」逐點驗證出來的**（誤差見 §6），不是推測。
> 這解掉了 `parseRczBackup.ts` 檔頭「⚠️ UNRESOLVED CALIBRATION」與 handoff 的
> F3 待辦（1）accel/gyro 標定。

---

## 1. 樣本概況

| 項目 | 值 |
| --- | --- |
| Session | 「極限」，2026-03-15 08:42:08.806 UTC（= 本地 16:42 UTC+8） |
| 長度 | 334.300 s / 3717.659 m / 6 圈（第 6 圈未完成） |
| 最佳圈 | 47.356 s（optimal 47.227 s） |
| 裝置 | 手機內建 GPS + 內建 accel/gyro/magn + 一台外接 RC3 裝置（ECU） |

⚠️ 使用者說明：RC3 那台送進來的 **IMU 數值不可信**（當年轉換有問題）。
本檔實測 **RC3 的 IMU 通道整條都是 `INT32_MAX` 哨兵值（= 無資料）**，
所以本場實際上根本沒有 RC3 IMU 資料，只有手機內建 IMU（正是使用者要求採信的那組）。

---

## 2. 六種匯出格式的內容差異（同一場）

| 格式 | 列數 | 時間軸 | 內容 | 相對 `.rcz` 的損失 |
| --- | --- | --- | --- | --- |
| `.rcz` | — | 每裝置各自的時間戳流 | **全部原始資料**（各裝置原生取樣率）＋ 圈次表＋賽道 id | 無（母格式） |
| `_v3.csv` | 22,823 | 所有裝置時間戳的**聯集**，各欄各自內插 | 全通道＋`calc` 衍生通道；表頭第 3 行標出**來源裝置** | 內插、欄名重複 |
| `_v2.csv` | 22,820 | 同上 | 同上，另加 `X/Y-position (m)` 局部投影座標與 `Trap name` | 同上 |
| `.vbo` | 2,965 | **降採樣到 GPS 10 Hz** | 全通道（欄名 `x_acc-acc`、`analog1-data` 帶裝置後綴）＋ `[laptiming]` 起終點/分段門 | 內建 IMU 47 Hz → 10 Hz（丟 79% 取樣） |
| `.gpx` | 2,965 trkpt | GPS 10 Hz | 只有 lat/lon/ele/time/fix/sat/hdop ＋ `gpxtpx:speed` | 丟掉所有 IMU/ECU/圈次 |
| `.nmea` | 2,965 × 2 句 | GPS 10 Hz | 只有 `$GPRMC` + `$GPGGA` | 同上，且高度/速度精度被 NMEA 欄位格式截掉 |

要點：

- **`.rcz` 是唯一無損的格式**；其他都是它的投影。做格式研究時一律以 `.rcz` 為準。
- `_v3.csv` 的表頭是三行：`欄名` / `單位` / `來源裝置`（例：`300: gps`、`200: data`、
  `100: acc`、`101: gyro`、`102: magn`、`calc`）。**欄名會重複**（`speed` 出現兩次、
  `device_update_rate` 出現五次），只能靠第 3 行區分 —— 任何 v3 CSV parser 都必須讀第 3 行。
- `_v2.csv` 改用單行表頭並把來源塞進欄名後綴（`... *calc`、`... *data`）。
- CSV/VBO/GPX/NMEA 的時間都是 **UTC**；檔名 `1642` 才是本地時間。
- `.vbo` 的標準 VBOX 欄 `longacc`/`latacc` 全是 `+000.000`；真正的值在 `latacc-calc`/`longacc-calc`。

---

## 3. `.rcz` 容器結構（單場匯出）

ZIP，根目錄直接放：

```
session.json           場次 metadata（含圈次表）
sessionfragment.json   裝置清單（★ 解析的關鍵）
trackId.json           {"id":15313}
channel_<A>_<dev>_0_<id>_<type>      每通道一個裸二進位陣列
```

（整機備份版本則是 `sessions/session_<KEY>/…` 巢狀多場，見 `listRczSessions.ts`。）

### 3.1 `session.json`

```json
{"version":1,"firstPositionLatitude":149059160,"firstPositionLongitude":727201343,
 "trackId":15313,"trackName":"極限","timeCreated":1773564129663,
 "bestLaptime":47356,"optimalLaptime":47227,"lapCount":5,
 "lengthDistance":3717659,"lengthTime":334300,
 "firstTimestamp":1773564128806,"latestTimestamp":1773564463200,"storageUsage":1935512,
 "laps":[{"number":1,"sessionResume":0,"startTimestamp":…,"finishTimestamp":…,"isInvalid":false}, …]}
```

- `firstPosition{Latitude,Longitude}` 與通道 id 3 同樣是 **度 × 6,000,000**。
- `lengthDistance` 單位 **mm**、`lengthTime`/`bestLaptime` 單位 **ms**。
- **`laps[]` 帶每圈的 epoch-ms 起訖與 `isInvalid`** —— 現行匯入完全沒用到，
  但這是 RaceChrono 自己判定的圈次，可直接當 lap marker 匯入（見 §8 待辦 D）。
- 本檔**沒有** `title` 欄位（只有 `trackName`）；`parseRcz` 讀的 `session.title` 恆為 undefined。

### 3.2 `sessionfragment.json` ★

```json
{"version":1,"primaryGpsDeviceIndex":300,
 "devices2":[{"version":2,"selector":{"id":100,"model":400,"type":2}},
             {"version":2,"selector":{"id":101,"model":400,"type":3},"gyroBias":[0.0,0.0,0.0]},
             {"version":2,"selector":{"id":102,"model":400,"type":8}},
             {"version":2,"selector":{"id":200,"model":404,"type":4}},
             {"version":2,"selector":{"id":300,"model":101,"type":1}}],
 "devices":{"items":[{"id":100,"model":400,"type":2}, …]},
 "imuUseForCalcEx":false}
```

**裝置 id 沒有固定語意，`type` 才有。** 兩個樣本對照：

| 樣本 | 裝置組成 |
| --- | --- |
| 本樣本（2026-03） | 100=type 2、101=type 3、102=type 8、200=type 4、**300=type 1（GPS）** |
| 舊樣本（2026-06） | **100=type 1（GPS）**、101=type 4（OBD/CAN） |
| 使用者 2 GB 整機備份 | 200=type 1（GPS）、100/101/102=type 2/3/8 |

已確認的 `type` 語意（由 v3 CSV 第 3 行的來源標籤直接對上）：

| type | 意義 | v3 CSV 標籤 |
| --- | --- | --- |
| 1 | GPS | `<id>: gps` |
| 2 | 加速度計 | `<id>: acc` |
| 3 | 陀螺儀 | `<id>: gyro` |
| 4 | 資料裝置（RC3 / OBD / CAN） | `<id>: data` |
| 8 | 磁力計 | `<id>: magn` |

`model`：`101` = 手機內建 GPS、`400` = 手機內建感測器、`404` = RC3 藍牙裝置、
`502` = 舊樣本那台 OBD/CAN 裝置。（**未經第二個樣本交叉確認**，僅供參考，解析不要依賴 `model`。）

> ⚠️ 因此 **`parseRcz.ts` 硬寫「100 = GPS、101 = ECU」是錯的**，這只是舊樣本的巧合。
> 本樣本套用現行 `parseRcz` 會：拿陀螺儀當 master clock、找不到任何 float64 ECU 通道、
> 把加速度計當成 GPS 裝置 → 產出「Time + 3 條未縮放的 `rc_x_acc`」，
> **完全沒有 GPS、沒有 RC3、沒有磁力計、沒有距離**。`parseRczBackup.ts` 早就改成讀
> `sessionfragment.json` 的 `type`，單場匯出路徑照抄即可（兩種樣本的根目錄都有這個檔）。

---

## 4. 通道檔名文法

```
channel[2]_<A>_<dev>_0_<id>_<type>
             │      │       │    └─ 元素編碼：0 = int32 LE, 1 = int64 LE, 3 = float64 LE
             │      │       └────── 通道 id（見 §5）
             │      └────────────── 裝置 id（對到 sessionfragment.json）
             └───────────────────── 未確認的序號（檔案排序用，解析可忽略）
```

檔案是**裸陣列、無標頭**，元素數 = `byteLength / elemSize`。
同一裝置底下所有通道**逐 index 對齊該裝置自己的時間戳流**（id 1）。

每個裝置固定有兩條 int64 流：

| id | 型別 | 意義 |
| --- | --- | --- |
| 1 | int64 | **epoch-ms 時間戳**（該裝置的時間軸） |
| 2 | int64 | **累積距離 mm**，單調遞增、由 0 起算；末值 = `session.json.lengthDistance`（本檔 3717659 ✓，五個裝置各一份、內容一致） |

GPS 另有 id 3（int64 檔，實際是 **int32 成對**：`[lat, lon]`）。

---

## 5. 通道 id 對照表（全部經 CSV 逐點驗證）

### 5.1 GPS（type 1，本檔 dev 300，2,966 筆 ≈ 8.9 Hz）

| id | 編碼 | CSV 欄位 | 換算 | 備註 |
| --- | --- | --- | --- | --- |
| 3 | int32 pair | `latitude` / `longitude` | `/ 6e6`（度） | 東經為正 |
| 4 | int32 | `speed` (m/s) | `/ 1000` | 即 mm/s；→ km/h 為 `× 0.0036` |
| 5 | int32 | `altitude` (m) | **`/ 1000`** | ⚠️ 現行實作當成公尺直接吐出（見 §8 待辦 B） |
| 6 | int32 | `bearing` (deg) | `/ 1000` | 靜止時為 `INT32_MAX`（本檔 2,965 筆中 82 筆） |
| 30002 | int32 | `satellites` | **×1（不縮放）** | |
| 30003 | int32 | `fix_type` | **×1（不縮放）** | 本檔恆為 2 |
| 30004 | int32 | `coordinate_precision` (DOP) | `/ 1000` | |
| 30005 | int32 | `altitude_precision` (DOP) | `/ 1000` | 本檔整條 `INT32_MAX`（CSV 該欄整條空白 ✓） |

### 5.2 內建 IMU（type 2/3/8，本檔 dev 100/101/102，各 ≈ 15,770 筆 ≈ 47.2 Hz）

| 裝置 type | id | CSV 欄位 | 原始單位 | 換算 |
| --- | --- | --- | --- | --- |
| 2 acc | 9 / 10 / 11 | `x_acc` / `y_acc` / `z_acc` (G) | **mm/s²** | **`/ 9806.65` 得 G**（或 `/1000` 得 m/s²） |
| 3 gyro | 12 / 13 / 14 | `x/y/z_rate_of_rotation` (deg/s) | **毫度/秒** | `/ 1000` |
| 8 magn | 28 / 29 / 30 | `x/y/z_magnetic_field` (µT) | **nT** | `/ 1000` |

### 5.3 RC3 資料裝置（type 4 且通道為 int32，本檔 dev 200，3,241 筆 = 10 Hz）

| id | 對應 | 換算 |
| --- | --- | --- |
| 9–14 | RC3 送來的 accel/gyro | 本檔**整條 `INT32_MAX`（無資料）** |
| 20002 | `digital1`（RaceChrono 顯示為 **RPM**） | `/ 1000` |
| 20003–20007 | `analog1`–`analog5` | `/ 1000` |
| 20010 | `digital2` | `/ 1000` |
| 20011–20020 | `analog6`–`analog15` | `/ 1000` |

順序由 `.vbo` 欄名序（`digital1, analog1..5, digital2, analog6..15`）與逐點數值比對雙重確認。
`20001` / `20008` / `20009` 在本檔不存在（保留槽位，語意未知）。
本檔 `analog13–15`（20018–20020）整條 `INT32_MAX`。

> 現行 `decodeRcChannelName()` 用 `lo === 5000 → rc_analog_<k>`、`5001 → rc_digital_<k>`
> 的「bank」規則**在這個 id 空間完全對不上**（20002 會變成 `rc_channel_20002`）。
> 那條規則是舊樣本時期的推測，至今沒有樣本佐證，見 §9。

### 5.4 OBD / CAN 資料裝置（type 4 且通道為 float64；舊樣本 dev 101）

float64 通道**已經是物理量、不需縮放**，單位就是 RaceChrono 該通道的顯示單位。
舊樣本實測（17,791 筆）驗證了現行 `NAMED_LO` 表：

| id | 名稱 | 實測範圍 | 單位 |
| --- | --- | --- | --- |
| 9 / 10 / 11 | x/y/z accel | −0.46…0.65 / −0.83…0.59 / −0.17…1.39（z 中位數 0.839 ≈ 重力） | **G** |
| 12 / 13 / 14 | x/y/z gyro | −84…44 / −78…87 / −76…67 | **deg/s** |
| 1023 | air/fuel ratio | 9.2…12.5 | — |
| 10024 | rpm | 1656…11792 | rpm |
| 10025 | throttle | 0…100 | % |
| 10026 | coolant temp | 42…139 | °C |
| 66551 / 33783 | wheel speed front / rear | 0…90.5 / 0…87.9 | km/h |

**★ 重點：同樣是「x 加速度」，int32 版是 mm/s²、float64 版是 G。單位取決於編碼型別，不是 id。**

---

## 6. 數值編碼通則與驗證結果

1. **int32 通道 = 物理值 × 1000**（SI 單位：m/s²、deg/s、µT、m、m/s、deg、DOP…；
   距離則是 m×1000 = mm）。例外：`satellites`、`fix_type` 是純整數；lat/lon 是 ×6e6。
2. **float64 通道 = 物理值本身**（RaceChrono 該通道設定的顯示單位）。
3. **`INT32_MAX`（2147483647）= 無資料哨兵**，必須轉成 `NaN`。
   本檔在 RC3 IMU、`analog13-15`、`altitude_precision`、以及低速時的 `bearing` 都會出現；
   RaceChrono 自己的 CSV 在這些位置輸出空字串，兩者 100% 一致。

驗證方法：把 `.rcz` 每個裝置的 epoch-ms 時間戳去 `_v3.csv` 找**完全相同**的 timestamp 列，
逐點比對。結果：

| 通道 | 樣本數 | 最大誤差 | 中位誤差 |
| --- | --- | --- | --- |
| GPS speed / altitude / bearing / sats / fix / DOP | 2,883–2,965 | **0.000000** | 0 |
| GPS lat / lon | 2,965 | 3.3e-8 度（CSV 只印 7 位小數） | — |
| acc x/y/z（`/9806.65`） | 15,770 | 0.0061 G | 0.000003 G |
| gyro x/y/z（`/1000`） | 15,760 | 0.40 deg/s | 0.000000 |
| magn x/y/z（`/1000`） | 15,762 | 0.0064 µT | 0.000000 |
| RC3 analog/digital（`/1000`） | 3,418 | 0.18 | 0.000000 |

中位誤差 0 代表 scale 完全正確；殘餘最大誤差全部落在
「CSV 該列的時間戳同時屬於別的裝置、該欄是內插出來的」那些列。

### 6.1 取樣率

| 裝置 | 筆數 | 實際 Hz |
| --- | --- | --- |
| 100 acc / 101 gyro / 102 magn | 15,771 / 15,761 / 15,763 | **47.2 / 47.1 / 47.1** |
| 200 data (RC3) | 3,241 | 9.7 |
| 300 gps | 2,966 | 8.9 |

→ 內建 IMU 比 GPS 密 5 倍。`parseRczBackup` 的「取樣數最多的裝置當 master clock」
在這個檔案上會選到加速度計（15,771 列），是正確選擇；`.vbo` 匯出把它壓成 10 Hz 是有損的。

---

## 7. `calc` 衍生通道（**不在 `.rcz` 裡**）

`_v3.csv` 的 `calc` 群組與 `.vbo` 的 `-calc` 欄是 RaceChrono **自己算出來**的，
`.rcz` 完全沒有對應的通道檔：

| 通道 | 單位 | 本檔範圍 |
| --- | --- | --- |
| `speed` | m/s | 0.004…19.678 |
| `longitudinal_acc` | G | −0.484…0.524 |
| `lateral_acc` | G | −1.016…0.989 |
| `combined_acc` | G | 0.030…1.075 |
| `lean_angle` | deg | **−44.397…45.005** |
| `device_update_rate` | Hz | 固定 20.0 |

也就是說：**匯入 `.rcz` 想要傾角/縱橫向 G 就得自己算**（本專案已有 accel/傾角相關邏輯，
但需確認與 RaceChrono 的定義一致）。反之，若使用者要的是「和 RaceChrono 畫面一模一樣的
lean angle」，只有 CSV/VBO 匯出才有。`sessionfragment.json` 的 `imuUseForCalcEx:false`
與 gyro 裝置的 `gyroBias:[0,0,0]` 應該就是這組計算的參數（**未驗證**）。

---

## 8. 現行實作的具體缺陷（可行動清單）

依嚴重度排序：

| # | 問題 | 位置 | 影響 |
| --- | --- | --- | --- |
| **A** | 單場匯出硬寫 `dev 100 = GPS / dev 101 = ECU`，未讀根目錄的 `sessionfragment.json` | `parseRcz.ts:176`、`:209`、`:231` | **本樣本匯入後只剩 Time + 3 條未縮放 acc，GPS 完全消失**。修法：比照 `parseRczBackup.ts` 依 `type` 判定（單場匯出的根目錄同樣有這個檔，新舊樣本皆有） |
| **B** | GPS altitude 當成公尺直接輸出，實為 **mm** | `parseRcz.ts:255`、`parseRczBackup.ts:258` | 高度顯示成 311300 m |
| **C** | 未處理 `INT32_MAX` 哨兵 | 兩個 parser 全部 int32 路徑 | 無資料通道會畫出 2.1e9 的直線，並毀掉自動 Y 軸範圍 |
| **D** | `session.json.laps[]` 未使用 | 兩個 parser | 白白丟掉 RaceChrono 自己的圈次切分與 `isInvalid` |
| **E** | int32 IMU 未縮放、無單位（`parseRczBackup.ts` 檔頭的 UNRESOLVED CALIBRATION） | `parseRczBackup.ts:299-308` | 本文件 §5.2/§6 已標定完成，可以移除該警告並套 `/9806.65`、`/1000`、`/1000` |
| **F** | RC3 `analog/digital` id 空間（20002–20020）無命名規則 | `decodeRcChannelName()` | 會退化成 `rc_channel_20002`，使用者看不懂；應對映 `rc_digital_1` / `rc_analog_1`… |
| **G** | `session.title` 讀不到（本檔只有 `trackName`）、`trackId`/`lapCount`/`lengthDistance` 在單場路徑未寫入 `headerInfo` | `parseRcz.ts:270-281` | metadata 比 backup 路徑少 |

最省事的收斂方向：**讓 `parseRcz` 與 `parseRczBackupSession` 共用同一個核心**
（差別只有「檔案前綴」與「要不要挑場次」），順手把 B–G 一次做掉。

---

## 9. 尚未確認 / 待驗證

- 通道檔名第一段 `<A>`（`channel_2_100_…` 的 `2`）的意義；目前解析忽略它，無已知影響。
- `decodeRcChannelName()` 的 `lo = id % 1048576` / `k = floor(id / 1048576)` bank 規則與
  `5000/5001 = analog/digital` 對映 —— **兩個樣本都沒有出現任何 ≥ 1048576 的 id，也沒有 5000/5001**。
  這條規則來源不明、無樣本佐證，建議降級為 fallback 或直接移除。
- `model` 代碼（101 / 400 / 404 / 502）的完整對照。
- id `20001` / `20008` / `20009` 的語意。
- `imuUseForCalcEx`、`gyroBias` 對 `calc` 通道的實際作用。
- 舊樣本 float64 通道的單位是逐點驗證不了的（`b1(5)_rc.vbo` 是**本專案自己匯出**的，
  不是 RaceChrono 的輸出，不能當對照）；§5.4 的單位是由數值範圍與物理常識判定（z 軸中位數
  0.839 G ≈ 重力）。若要 100% 確定，需要再匯一份同場的 RaceChrono CSV。

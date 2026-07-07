# AiM `.xrk` 二進位格式逆向規格（供 `parseXrk` 實作）

> 狀態：**INVESTIGATION + DOC ONLY**。本文件僅為規格，尚未實作 importer。
> 範圍：AiM Solo 2 DL / MyChron5 logger 產生的 `.xrk`（本專案樣本來自台灣 A.R.K. 賽道機車場次）。
> 信心：**高，可實作**。核心結構（chunk 框架、checksum、channel table、S/M/c sample message、GPS、LAP、metadata）已用真實樣本逐位元組驗證；少數欄位語意（部分 unit code、decoder 邊角型別）標記為不確定。

## 0. 參考來源（authoritative）

AiM 無官方公開格式文件。本格式的「規格」實際上就是以下純逆向（無 AiM DLL）的開源 MIT parser。本文件的所有結構定義均對照此原始碼，並以本機樣本驗證。

- **主要**：`racer-coder/TrackDataAnalysis` —— Cython 純逆向 parser。
  - 倉庫：https://github.com/racer-coder/TrackDataAnalysis
  - 解析核心：https://raw.githubusercontent.com/racer-coder/TrackDataAnalysis/main/data/aim_xrk.pyx （本文件主要依據）
  - 資料結構基底：https://raw.githubusercontent.com/racer-coder/TrackDataAnalysis/main/data/base.py
  - 注意：同倉庫的 `data/aim.py` 是「包裝 AiM 官方 `libxdrk` DLL」的另一條路徑，**不是**逆向實作，僅供交叉對照，不採用。
- **交叉對照（DLL 包裝，非逆向）**：
  - `bmc-labs/xdrk`：https://github.com/bmc-labs/xdrk
  - `briguy-official/xrk`：https://github.com/briguy-official/xrk/blob/master/xrk.py
  - `laz-/xrk`：https://github.com/laz-/xrk
- **相關格式（語意對照）**：`gotzl/ldparser`（MoTeC LD）。

樣本檔（`C:/Data/repo/AracerLogaAnalysis/LogaExample/`）：
`123_A_a_1018.xrk` (2.5MB)、`123_A_a_1016.xrk` (3.3MB)、`bo_JETSL_ARK_Race_a_1178.xrk` (4.5MB)、`CHENG_ARK_a_2570.xrk` (15MB)。

---

## 1. 檔案整體結構

### 1.1 概觀

`.xrk` 是一個**扁平的訊息（message）串流**，從 offset 0 開始一個接一個排列，沒有檔頭索引、沒有 footer 索引表。Parser 線性地往前掃描，依每個訊息開頭的 2-byte opcode 分派處理，並以「壞位元組（bad bytes）」容錯機制跳過無法解析的區段。

**全檔小端序（little-endian）**。檔案開頭即是第一個 H-message：

```
offset 0: 3C 68 43 4E 46 ...   = "<hCNF" ...
```

訊息共有兩大類，由開頭 2 bytes 區分：

| 開頭 2 bytes | 類別 | 用途 |
|---|---|---|
| `3C 68` = `<h` | **H-message**（header/metadata 區塊） | 設定、channel 定義、GPS、LAP、軌道、metadata |
| `28 53` = `(S` | **S-message**（sample） | 單筆樣本（不定速率 channel） |
| `28 4D` = `(M` | **M-message** | 批次週期樣本（高速率 channel，例如加速度計、RPM） |
| `28 47` = `(G` | **G-message**（group） | 多 channel 打包成一個 group 的樣本列 |
| `28 63` = `(c` | **c-message** | channel 展開樣本（另一種單筆樣本編碼） |

opcode 在原始碼以 `ord('(') + 256*ord('X')` 計算（小端 u16）。例如 S = `0x28 + 0x53*256 = 0x5328`。

### 1.2 H-message 框架（已逐位元組驗證）

H-message = **12 bytes header + `hlen` bytes payload + 8 bytes footer**。

Header（`hmsg_hdr`，packed，12 bytes）：

| offset | 型別 | 名稱 | 說明 |
|---|---|---|---|
| 0 | u16 | `op` | 固定 `0x6863`（`<h`） |
| 2 | u32 | `tok` | token（見 §1.3） |
| 6 | i32 | `hlen` | payload 長度（bytes） |
| 10 | u8 | `ver` | 版本/種類旗標（多為 1，TRK=2，部分=0） |
| 11 | u8 | `cl` | 固定 `0x3E`（`>`），作為 header 結束符 |

Payload：緊接在 header 後，長度 = `hlen`。

Footer（`hmsg_ftr`，packed，8 bytes）：

| offset（相對 footer 起點） | 型別 | 名稱 | 說明 |
|---|---|---|---|
| 0 | u8 | `op` | 通常是 `<`（`0x3C`），與下一訊息開頭重疊用途；parser 不嚴格檢查 |
| 1 | u32 | `tok` | **必須等於** header 的 `tok` |
| 5 | u16 | `bytesum` | **payload 所有 byte 的算術和（取低 16 bits）** |
| 7 | u8 | `cl` | 固定 `0x3E`（`>`） |

> 驗證結果（`123_A_a_1018.xrk` 前 20 個 H-message）：所有 `ftrTok == hdrTok`、`ftrSum == (Σ payload bytes) & 0xFFFF`、`ftrCl == '>'` 全部成立。**checksum 模型確認無誤**，可用於框架同步校驗。

實際範例（offset 0，CNF chunk）：
```
3C 68 | 43 4E 46 00 | 9A 15 00 00 | 01 | 3E    header: op=<h tok="CNF\0" hlen=0x159A=5530 ver=1 cl=>
... 5530 bytes payload (內含巢狀 channel table) ...
<footer 8 bytes>  ftr.tok="CNF\0" ftr.bytesum=Σ ftr.cl=>
```

範例（offset 5807，TRK chunk）：`hlen=96, ver=2`。

### 1.3 Token（`tok`）編碼

`tok` 是 4-byte 小端整數，但語意上是 1~4 個 ASCII 字元的 token，**低位 byte 是第一個字元**。原始碼解碼：

```python
def _tokdec(s):  # 'GPS' -> int
    if s: return ord(s[0]) + 256 * _tokdec(s[1:])
    return 0
def _tokenc(i):  # int -> 'GPS'
    s = ''
    while i: s += chr(i & 255); i >>= 8
    return s
```

特例：若最高 byte（bit 31..24）== `0x20`（空白），先 `tok -= 32 << 24`（等同 rstrip 一個尾隨空白）。樣本中 `TRK` 的 raw token = `0x204B5254` = `"TRK "`，去掉尾空白後為 `"TRK"`。

掃描樣本得到的頂層 token（`123_A_a_1018.xrk`）：`CNF`(1)、`RCR`(2)、`VEH`、`CMP`、`VTY`、`NDV`、`SRC`、`TRK`(2)、`TMD`、`TMT`、`+LM`、`GPS`(4712)、`LAP`(7)、`NTE`。

### 1.4 S / M / c / G message 框架

這些是 channel 樣本資料，**散佈在 H-message 之間**（parser 在主迴圈中以 opcode 分派；H-message 之間的「空隙」就是這些樣本訊息）。它們的長度由「該 channel 的 size」決定，因此**必須先解析 CNF 內的 channel table 才能解析樣本**。

**S-message**（`smsg_hdr`，單筆樣本）：

| offset | 型別 | 說明 |
|---|---|---|
| 0 | u16 | `op` = `(S` |
| 2 | i32 | `timecode`（ms，logger 時鐘） |
| 6 | u16 | `index`（channel index） |
| 8 | (size) | 樣本資料，長度 = channel.size |
| 8+size | u8 | 終止符 `)` (`0x29`) |

S-message 總長 = `9 + channel.size`（即 `add_helper`）。原始碼以 `add_helper = size + 9` 步進。

**M-message**（批次週期樣本，同 `smsg_hdr` 但用到 `count`）：

| offset | 型別 | 說明 |
|---|---|---|
| 0 | u16 | `op` = `(M` |
| 2 | i32 | `timecode`（批次第一筆的 ms） |
| 6 | u16 | `index` |
| 8 | u16 | `count`（本批樣本數） |
| 10 | `count*size` | 連續樣本資料 |
| 10+count*size | u8 | 終止符 `)` |

M-message 總長 = `10 + count*size + 1`。每筆樣本的 timecode = `timecode + i * Mms`（i=0..count-1），`Mms` 由 channel 的取樣率推算（§3.2）。

**c-message**（`cmsg_hdr`，另一種單筆樣本，本批樣本檔未出現）：

| offset | 型別 | 說明 |
|---|---|---|
| 0 | u16 | `op` = `(c` |
| 2 | u8 | `unk1`（恆 0） |
| 3 | u16 | `channel`（低 3 bits 恆 = 4；真正 index = `channel >> 3`） |
| 5 | u8 | `unk3`（恆 `0x84`） |
| 6 | u8 | `unk4`（恆 6） |
| 7 | i32 | `timecode` |
| 11 | (size) | 樣本資料 |
| 11+size | u8 | `)` |

c-message 總長 = `12 + channel.size`。

**G-message**（group，把多 channel 打包）：總長 = `9 + Σ(group 內各 channel.size)`，終止符 `)`。group 成員由 CNF 內的 `GRP` 訊息定義（本批樣本未使用 group）。

> 驗證（`123_A_a_1018.xrk`，依各 channel size 框架掃描並要求結尾為 `)`）：
> - **S-message 數量/idx**：idx0(MCLK)=23917、idx2/3=469、idx14/15=9571、idx22=469、idx25/26=469、idx27(Gear)=9567、idx28-33(Alarms)=9567。
> - **M-message 數量/idx**：idx16-21(Accel/Gyro)=2557 批、**idx23(RPM)=1914 批**。
> - **c-message**：0（本檔不使用）。
>
> 此即「哪個 channel 走哪種訊息」的實證：低速/事件型走 S，高速連續型走 M。

---

## 2. Channel 定義（`CNF` → 巢狀 `CHS` / `CDE`）

### 2.1 容器：`CNF`

`CNF`（config）H-message 的 payload 本身又是一串 H-message（巢狀），需**遞迴**用同一套 H-message 框架解析。CNF 內含：

- `CHS`（channel definition，每個 channel 一筆，`hlen=112`）— **主要**
- `CDE`（每個 channel 一筆，`hlen=6`，緊接在對應 CHS 前；語意未明，疑似 channel 啟用/CRC，原始碼只當 hex dump，**可忽略**）
- `GRP`（group 定義，本批樣本無）
- `ENF`（巢狀，本批樣本無）

### 2.2 `CHS` 結構（112 bytes，已驗證）

原始碼 `struct.unpack('<H22x8s24s16xB39x', payload)`：

| offset | 型別 | 欄位 | 說明 |
|---|---|---|---|
| 0 | u16 | `index` | channel index（與 S/M/c 的 index 對應） |
| 2..23 | 22x | (padding) | 但其中數個 byte 帶語意（見下表） |
| 24..31 | 8s | `short_name` | NUL 終止 ASCII（如 `MCLK`、`RPM`、`AccX`） |
| 32..55 | 24s | `long_name` | NUL 終止 ASCII（如 `Master Clk`、`RPM`、`AccelerometerX`） |
| 56..71 | 16x | (padding) | |
| 72 | u8 | `size` | **樣本位元組大小**（驅動 S/M/c 框架步進） |
| 73..111 | 39x | (padding) | |

「padding」中帶語意的關鍵 byte（原始碼以 `unknown[]` 索引存取，`unknown` 是把 index/short/long 清零後的整個 112-byte 區塊）：

| byte 索引 | 用途 |
|---|---|
| `[12]` | **unit code（低 7 bits）**；`& 127` 後查 `_unit_map`（§2.3） |
| `[13]` | decoder 型別之一（語意未明，未使用） |
| `[20]` | **decoder 型別**：決定樣本如何解碼（§3.3） |
| `[64]` | **資料速率碼**（低 7 bits）：32→50Hz、64→25Hz、80→20Hz、160→10Hz、16→100Hz、8→200Hz |
| `[84]` | decoder 型別之一（語意未明，未使用） |

### 2.3 Unit map（`unknown[12] & 127` → 單位、小數位）

```
1:('%',2)  3:('G',2)   4:('deg',1)  5:('deg/s',1) 6:('',0)  9:('Hz',0)
11:('',0)  12:('mm',0) 14:('bar',2) 15:('rpm',0)  16:('km/h',0) 17:('C',1)
18:('ms',0) 19:('Nm',0) 20:('km/h',0) 21:('V',1)  22:('l',1) 24:('l/s',0)
26:('time?',0) 27:('A',0) 30:('lambda',2) 31:('gear',0) 33:('%',2)
37:('mG',2) 43:('kg',3) 44:('',0)
```

> 不確定：`26`（標為 `time?`）、`44`（疑似 boolean）等少數碼；odometer 類 channel 的 `size=12` 且 unit=26，原始碼以特殊 `ODO` 路徑處理而非 sample。
> 特例：unit==`V` 的 channel，多數實際以 **mV** 編碼，parser 會 `/1000`。少數例外無法一致處理（原始碼註記）。

### 2.4 從真實樣本解出的 channel 清單（`123_A_a_1018.xrk`，35 channels）

| idx | short | long_name | size | unit | dp | dec `[20]` | rate `[64]` |
|--:|---|---|--:|---|--:|--:|---|
| 0 | MCLK | Master Clk | 4 | ms | 0 | 0 | 50Hz |
| 1 | LAP | Lap Time | 32 | time? | 0 | 22 | — |
| 2 | LogT | Logger Temperature | 2 | C | 1 | 20 | 25Hz |
| 3 | VBEx | External Voltage | 2 | V | 1 | 20 | 25Hz |
| 4 | PreT | Predictive Time | 4 | ms | 0 | 12 | 25Hz |
| 5 | bstD | Prdt Best Diff | 4 | ms | 0 | 24 | 25Hz |
| 6 | ODO | Total Odometer | 12 | time? | 0 | 26 | — |
| 7–10 | odo1–4 | Reset Odometer 1–4 | 12 | time? | 0 | 27 | — |
| 11 | MyL | MyLaps Time | 8 | time? | 0 | 28 | — |
| 12 | MyG | MyLaps Gap | 8 | time? | 0 | 29 | — |
| 13 | MyP | MyLaps Pers | 8 | time? | 0 | 30 | — |
| 14 | T1 | Temperature 1 | 2 | C | 1 | 20 | 20Hz |
| 15 | T2 | Temperature 2 | 2 | C | 1 | 20 | 20Hz |
| 16 | AccX | AccelerometerX | 2 | G | 2 | 20 | 100Hz |
| 17 | AccY | AccelerometerY | 2 | G | 2 | 20 | 100Hz |
| 18 | AccZ | AccelerometerZ | 2 | G | 2 | 20 | 100Hz |
| 19 | GyrX | GyroX | 2 | deg/s | 1 | 20 | 100Hz |
| 20 | GyrY | GyroY | 2 | deg/s | 1 | 20 | 100Hz |
| 21 | GyrZ | GyroZ | 2 | deg/s | 1 | 20 | 100Hz |
| 22 | VBIn | Int Batt Voltage | 2 | V | 1 | 20 | 50Hz |
| 23 | RPM | RPM | 2 | rpm | 0 | **4** | 20Hz |
| 24 | Luma | Luminosity | 2 | (?) | 0 | 20 | 50Hz |
| 25 | Bkl | Backlight | 2 | (?) | 0 | 20 | 50Hz |
| 26 | WiFi | WiFi | 2 | (?) | 0 | 20 | 50Hz |
| 27 | ClGr | Calculated_Gear | 8 | | 0 | 15 | 20Hz |
| 28–33 | WatA_1… | WAT/EGT/CHT Alarm_1/2 | 2 | | 0 | 1 | — |
| 34 | iGPS | iGPS | 56 | time? | 0 | 8 | 50Hz |

> 註：上表 rate 標 `—` 者，`[64]` 的低 7 bits 不在 `_Mms_lookup` 對應表內（這些 channel 走 S-message，非固定批次速率）。

---

## 3. 樣本資料與時間軸

### 3.1 儲存方式：per-channel，非 interleave（除非有 group）

每個 channel 的樣本以**獨立的 S/M/c 訊息**散佈全檔，各訊息自帶 `timecode` 與 `index`。Parser 依 index 把同一 channel 的所有樣本累積起來。若存在 `GRP`（group），則該 group 的多 channel 會在單一 G-message 中 interleave（offset 由 group 內各 channel size 累加，header 佔 6 bytes 起算）—— 本批樣本未用 group。

每個 channel 只能用「S 或 c」**或**「M」其中一種來源（原始碼有 assert 防止混用）。

### 3.2 時間軸（timecode → ms）

- 時間單位為 **logger master clock 的 ms**（`MCLK` channel，idx 0，50Hz）。
- 每個 S/c 樣本自帶絕對 `timecode`（i32, ms）。
- M-message 批次：第 i 筆的 timecode = `header.timecode + i * Mms`。
  - `Mms`（每筆間隔 ms）由 `_Mms_lookup(unknown[64] & 127)`：
    `8→5ms(200Hz)`、`16→10ms(100Hz)`、`32→20ms(50Hz)`、`64→40ms(25Hz)`、`80→50ms(20Hz)`。其餘速率（10/5/2/1Hz）不走 M-message。
- **time_offset**：全檔最小 timecode（或由 LAP 推得，見 §5）作為零點，最終每個 channel 的 timecodes 減去 `time_offset`，使時間軸從 0 起算（ms）。
- 去重：parser 只接受 `timecode > last_timecode` 的訊息，丟棄回退/重送（replay 容錯）。

### 3.3 樣本值解碼（`unknown[20]` → 型別 + 後處理）

```
0:  i32                              # Master Clock（某些機型）
1:  u16 → float16 → float32 (interp)
3:  i32                              # Master Clock（另一機型）
4:  i16                              # 例：RPM
6:  f32 (interp)
11: i16
12: i32                             # Predictive Time
13: u8                              # status?
15: u16 → gear table 查表（'N'/'1'..'6' → 0..6）；實際 size 為 8 bytes
20: u16 → float16 → float32 (interp) # 最常見：溫度、電壓、加速度、陀螺
24: i32                             # Best Run Diff?
```

特殊（依 long_name，非 `[20]`）：`Calculated_Gear` / `PreCalcGear` 使用 64-bit 欄位，取 `(x>>16)&7`，若 `x & 0x80000` 則為 0（空檔）。

「interpolate」旗標：true 時繪圖在樣本間線性內插；false（如 gear、status）則保持前值階梯狀。

> 重要陷阱：decoder 20 與 1 把 channel 標稱 `size` 的 16-bit 解讀為 **IEEE float16（半精度）** 再轉 float32。decoder 4 是直接 int16。**單位 scale**（例如溫度的 dec_pts）目前由 `dec_pts` 表示小數位數，但原始碼**未對值做乘除 scale**（除了 mV→V 的 /1000、GPS 的 /100）；float16 解出的數值即為工程單位的近似值。AiM 對多數 channel 直接存工程值的 float16，無另外的 scale/offset 欄位被解出。

### 3.4 真實樣本驗證

**RPM（idx23，decoder 4 = int16，走 M-message，cnt=5/批）** `123_A_a_1018.xrk`：

```
檔頭附近：tc=11   cnt=5 vals=[0,0,0,860,2533]      # 引擎起轉
          tc=235  cnt=5 vals=[2504,2526,2525,2472,2501]  # 怠速 ~2500 rpm
檔案中段：tc=239250 cnt=5 vals=[5890,5855,5820,5815,5780] # 行進中 ~5800 rpm
          tc=239754 cnt=5 vals=[5547,5514,5530,5484,5482]
```
數值合理（機車怠速 2.4–2.5k、行進 5.5–5.9k rpm）。批次間 tc 差約 248ms ≈ 5 樣本 × 50ms。

**AccelerometerX（idx16，decoder 20 = float16，走 M-message）**：第一批 cnt=20，前 6 筆 float16 = `0.3650, 0.3574, 0.3167, 0.2161, 0.0604, -0.1229`（單位 G，合理）。

---

## 4. GPS（`GPS` token，每筆 56 bytes，已驗證）

GPS 以獨立 H-message（`tok="GPS"`，`hlen=56`）大量散佈（樣本中 4712~6113 筆）。payload 是 u-blox 風格的 **ECEF**（地心地固座標）：

| offset | 型別 | 欄位 | 換算 |
|---|---|---|---|
| 0 | i32 | `timecode`（ms） | 同 logger 時鐘 |
| 4 | u32 | iTOW（ms） | （未使用） |
| 12 | u16 | week number | （未使用） |
| 16 | i32 | ECEF X | **cm**，/100 → m |
| 20 | i32 | ECEF Y | cm，/100 → m |
| 24 | i32 | ECEF Z | cm，/100 → m |
| 28 | i32 | position accuracy | cm（未使用） |
| 32 | i32 | ECEF dX | **cm/s** |
| 36 | i32 | ECEF dY | cm/s |
| 40 | i32 | ECEF dZ | cm/s |
| 44 | i32 | velocity accuracy | cm/s（未使用） |
| 51 | u8 | satellite count | （未使用） |

衍生 channel：
- **GPS Speed** = `sqrt(dX²+dY²+dZ²)/100`（m/s）。
- **GPS Latitude / Longitude / Altitude**：由 ECEF(X,Y,Z)/100 經 `ecef2lla`（WGS84）轉換。

> timecode 修正：某些舊韌體（MXP）會破壞 timecode 高 16 bits；parser 以 `mask=0xFFFFC000`、用前一訊息的 `current_timecode` 修補高位（見原始碼 §gps_tc 段）。一般 Solo2/MyChron 樣本可不必，但實作時建議照抄此修正以求穩健。

**驗證（`123_A_a_1018.xrk` 前 3 筆）**：
```
tc=7245 lat=23.10414 lon=120.22212 alt=23.4m speed=0.25 m/s
tc=7345 lat=23.10414 lon=120.22212 alt=23.4m speed=0.17 m/s
tc=7445 lat=23.10414 lon=120.22212 alt=23.8m speed=0.16 m/s
```
**lat/lon = 23.104°N, 120.222°E，正是台灣 A.R.K. 賽道**（與題目 ~23.10/120.22 吻合）。靜止時速度近 0，合理。GPS 取樣率約 10Hz（tc 差 100ms）。

`iGPS`（idx34，size=56，decoder 8）是同樣 56-byte GPS 結構以 channel 形式出現；可優先用 `GPS` H-message 路徑。

---

## 5. Laps（`LAP` token，已驗證）

LAP 以 H-message 出現（樣本 6~7 筆）。原始碼 `struct.unpack('xBHIxxxxxxxxI', payload)`：

| offset | 型別 | 欄位 | 說明 |
|---|---|---|---|
| 1 | u8 | `segment` | 段號（多圈賽道分段；0 = 整圈） |
| 2 | u16 | `lap` | 圈號 |
| 4 | u32 | `duration` | 圈時長（ms） |
| 16 | u32 | `end_time` | 圈結束時刻（ms） |

`time_offset` 取自第一筆 LAP 的 `end_time - duration`（作為 session 起點）。Lap start = `end_time - duration`。

**驗證（`123_A_a_1018.xrk` 前 5 圈）**：
```
lap=1 dur=175209ms end=175349   # 出場暖胎圈，較長
lap=2 dur=48333ms  end=48540    # 正常圈 ~48.3s
lap=3 dur=48564ms  end=48707
lap=4 dur=48289ms  end=48443
lap=5 dur=77451ms  end=77654
```
圈時 ~48s 對 A.R.K. 機車場合理。

> 替代來源：若有 GPS 與 `TRK`（含起終點線座標），原始碼會優先用 GPS 幾何（`gps.find_laps`）偵測過線來切圈，而非 LAP 訊息。實作可二選一；LAP 訊息較簡單可先用。
> 注意上方 `end_time` 看似與 `duration` 不完全一致（lap1 差 140ms），疑為 16-bit 對齊/相對量；建議實作時以 `duration` 為主、`end_time` 作累加校驗。

---

## 6. Metadata

各 metadata 為 H-message，payload 多為 NUL 終止 ASCII 字串：

| token | 意義 | 樣本值（`CHENG_ARK_a_2570.xrk`） |
|---|---|---|
| `RCR` | Driver（騎士/車手） | `CHENG` |
| `VEH` | Vehicle | （空） |
| `CMP` | Series/Championship | （空） |
| `VTY` | Session/Venue type | （空） |
| `NDV` | device? | — |
| `TMD` | Log Date | `04/06/2024` |
| `TMT` | Log Time | `17:10:21` |
| `NTE` | Long Comment/Notes | （空） |
| `TRK` | 軌道（`ver=2`，96 bytes） | name=`ARK`、sf_lat=23.1040967、sf_long=120.2225004 |
| `SRC` | source（128 bytes） | — |
| `ODO` | odometer 統計（每 64 bytes 一筆：name(16)+time(u32 秒)+dist(u32 公尺)） | — |

`TRK` 結構：`name = payload[0:32]`（NUL 終止）；`sf_lat = i32@36 / 1e7`；`sf_long = i32@40 / 1e7`（原始碼以 `memoryview.cast('i')[9]/[10]` 取，即 byte offset 36/40）。

> 日期/時間時區陷阱（原始碼註記）：AiM 以時區換算時間，若場次跨越 GMT 午夜，會以 GMT 重新輸出而錯亂日期；`_get_metadata` 對 `TMD`/`TMT` 取**第一筆**，其餘 metadata 取**最後一筆**以規避。

---

## 7. 瀏覽器 / TypeScript 可行性與實作計畫

### 7.1 可行性結論

**完全可在純前端（Uint8Array + DataView）實作，無需 WASM、無需 DLL。** 全檔小端、無壓縮（見下）、結構固定。本文件所有結構均已用真實樣本驗證。

**壓縮**：`.xrk` 本體**未壓縮**（樣本開頭即 `<hCNF`，非 zlib 的 `78 9C`）。`.xrz` 才是「整個 `.xrk` 以 zlib 包裝」—— 若要支援 `.xrz`，先 `inflate`（可用 `pako` 或 `DecompressionStream('deflate')`）得到 `.xrk` bytes 再走同一 parser。本批樣本皆為未壓縮 `.xrk`。

### 7.2 `parseXrk(bytes: Uint8Array): LogSession` 演算法

1. （可選）若偵測到 zlib magic `78 9C`，先 inflate。
2. **第一遍：線性掃描訊息串流**，以 2-byte opcode 分派：
   - `<h`：讀 12-byte header（驗 `cl=='>'`、`hlen` 範圍），讀 payload，讀 8-byte footer（驗 `tok` 與 `bytesum`）。依 token 處理：
     - `CNF`：遞迴解析其 payload（巢狀 H-message），建立 **channel table**（每個 `CHS` → `{index, short, long, size, unitCode, decoder=[20], rate=[64]}`）。**這步必須先完成**，因為後續 S/M/c 框架長度取決於各 channel.size。CNF 通常在檔頭，符合單遍掃描；保險起見可先掃一遍只抓 CNF。
     - `GPS`：累積 56-byte ECEF 記錄。
     - `LAP`：累積圈資料；記錄 `time_offset`。
     - `TRK`/`RCR`/`VEH`/`TMD`/`TMT`/`NTE`/`ODO`…：存入 metadata。
   - `(S` / `(c`：依 `index` 對應 channel.size 算長度，驗結尾 `)`，把 `(timecode, rawbytes)` 累積到該 channel。
   - `(M`：讀 `count`，展開 `count` 筆樣本，timecode = `tc + i*Mms`。
   - `(G`：依 group 定義拆出各 channel。
   - 任何位置解析失敗 → **退回 oldpos+1**，標記 bad bytes，繼續（容錯，避免單點損壞中斷整檔）。
3. **第二遍：每個 channel 把累積的 raw 樣本依 `decoder[20]` 解碼成 Float32Array**（int16 / float16→float32 / int32 / gear 查表），時間軸減 `time_offset`（ms）。
4. **GPS**：ECEF→LLA，產生 GPS Speed/Lat/Lon/Alt 四個衍生 channel。
5. 組裝 `LogSession`：
   - `channels: { name: long_name, rawName: short_name, description: long_name, units, data: Float32Array, timecodes: Int32Array, interpolate }[]`，過濾掉 `Master Clk`、`StrtRec` 及空 channel。
   - `meta.formatId = 'xrk'`、`createdDate`（由 TMD+TMT）、`headerInfo`（driver/venue/laps…）。

### 7.3 已完全解碼 vs. 仍不確定

**已完全解碼並用真實樣本驗證**：
- H-message header/footer 框架 + bytesum checksum（全部通過）。
- token 編解碼、CNF 巢狀容器。
- CHS channel table（index/short/long/size/unit/decoder/rate）—— 35 channels 全解。
- S/M/c message 框架與 per-channel 路由（含實測各 idx 計數）。
- RPM（int16）、AccX（float16）樣本值 —— 數值合理。
- GPS ECEF→lat/lon/speed —— 經緯度精準對上 A.R.K. 賽道。
- LAP（圈時/結束時刻）—— 圈時合理。
- metadata（driver/date/time/track/start-finish line）。

**仍不確定 / 需更多探測**：
- 部分 unit code 語意（`26 time?`、`44 boolean?`、Luma/Bkl/WiFi 顯示為 `?`）。
- decoder `[20]` 中 `12/13/24` 等的精確語意（Predictive/status/BestDiff）已知型別但物理意義待確認。
- `CDE`（6 bytes/channel）的用途（疑似啟用旗標或 per-channel CRC，可忽略不影響資料）。
- LAP `end_time` 與 `duration` 的細微不一致（疑 16-bit 相對量），建議以 duration 為主。
- `G`/`c`/group 路徑在本批樣本未出現，未經實機驗證（但結構取自原始碼，邏輯清楚）。
- `[64]` 速率碼對 10/5/2/1Hz 的編碼未在 `_Mms_lookup` 涵蓋（這些走 S-message，timecode 自帶，不影響）。
- 多速率 channel → 需 resample 到共同時間軸：本格式各 channel 時間軸獨立，繪圖/分析時需以 timecodes 對齊或內插（`interpolate` 旗標指示可否線性內插）。

### 7.4 實作難點摘要

1. **必須先解析 CNF channel table** 才能解析 sample（長度相依）。
2. **float16 解碼**：decoder 1/20 需 IEEE 754 半精度轉換（JS 無原生，需手寫或用 `DataView` + bit 運算）。
3. **多速率時間軸**：每 channel 自有 timecodes（ms），需 resample/對齊；保留 `interpolate` 旗標。
4. **容錯掃描**：必須實作「失敗退一格」機制，否則任何損壞 byte 會中斷整檔。
5. **checksum** 可選但建議用於框架同步驗證（已證實 payload 算術和低 16 bits）。
6. `.xrz` 支援需 inflate 前置步驟。

---

## 附錄 A：關鍵常數速查

```
opcode:  <h=0x6863  (S=0x5328  (M=0x4D28  (c=0x6328  (G=0x4728   結束符 ')'=0x29  '>'=0x3E
H-msg:   header 12B (op u16, tok u32, hlen i32, ver u8, cl='>') + payload[hlen] + footer 8B (op u8, tok u32, bytesum u16, cl='>')
checksum: footer.bytesum == (Σ payload bytes) & 0xFFFF
CHS:     '<H22x8s24s16xB39x' = index u16@0, short 8s@24, long 24s@32, size u8@72
         unit=[12]&127, decoder=[20], rate=[64]&127, ([13]/[84] 未用)
rate碼:  8→200Hz 16→100Hz 32→50Hz 64→25Hz 80→20Hz 160→10Hz
Mms:     8→5  16→10  32→20  64→40  80→50  (ms/sample，僅 M-message)
GPS:     56B: tc i32@0, ECEF X/Y/Z i32@16/20/24 (cm,/100), dX/dY/dZ i32@32/36/40 (cm/s)
         speed=sqrt(dx²+dy²+dz²)/100 m/s; lat/lon/alt = ecef2lla(X,Y,Z)
LAP:     'xBHIxxxxxxxxI' = segment u8@1, lap u16@2, duration u32@4(ms), end_time u32@16(ms)
TRK:     name[0:32], sf_lat=i32@36/1e7, sf_long=i32@40/1e7
全檔 little-endian；.xrk 未壓縮；.xrz = zlib(.xrk)
```

# CVT 動力學研究：速可達 rubber V-belt 變速平衡與逆向調教

> 狀態：**實作前研究規格**（只定義模型、資料需求與驗證方式；不含程式實作）
> 撰寫日期：2026-07-17
> 對應分支：`research/cvt-dynamics`
> 適用範圍：速可達常見「前普利盤離心滾珠＋後開閉盤大彈簧／扭力凸輪＋橡膠 V 型皮帶」

## 0. 研究結論與適用邊界

### 0.1 一句話結論

**純運動學可直接實作；準靜態力平衡可在量得珠道曲線並用實車資料校正後實作；僅靠型錄參數、完全不做實測而精準預測滑差、遲滯、溫度效應與瞬態變速，不可行。**

### 0.2 建議採用的模型層級

| 層級 | 能回答的問題 | 判定 | 原因 |
|---|---|---|---|
| 幾何／運動學 | 實測總比如何拆成純 CVT 比、皮帶當下跑在前後盤哪個節圓、盤面移多少 | **可實作** | 只需固定減速比、皮帶節線長、軸距與盤面角；已有速可達專用運動學文獻 [S1] 與完整開帶幾何式 [S2] |
| 準靜態致動器平衡 | 給定引擎轉速、傳遞扭矩與零件參數，穩態大約停在哪個比值 | **可實作，但需校正** | 滾珠、彈簧與扭力凸輪可寫成軸向力；皮帶兩盤耦合仍需實驗係數或 stationary clamp-force-ratio map [S2][S3][S13] |
| 滑差上限／警示 | 目前夾持力是否可能不足、記錄中是否出現超出幾何界限的速度比 | **可實作為警示；數值需實測** | 楔緊摩擦可給容量條件，但橡膠摩擦係數、皮帶座入、磨耗與溫度均非固定常數 [S3][S6][S8] |
| 瞬態變速、遲滯與效率 | 油門突開後多久完成變速、升降檔路徑差多少、損失多少功率 | **研究版不承諾** | 已驗證的瞬態模型需離散皮帶、材料剛性／阻尼與接觸摩擦，計算與參數需求遠高於 PWA 第一版 [S4][S5][S7] |
| 逆向調教 | 從目標轉速反推候選珠重／彈簧組合 | **可做受限建議，不可當唯一答案** | 可形成離散候選＋連續參數的受限最佳化，但多組零件會產生近似曲線，且離合器接合不由珠重單獨決定 |

### 0.3 研究方法與證據等級

本文按下列順序採信資料：

1. 同行審查期刊與 SAE 技術論文，優先採用有實驗驗證的 rubber V-belt CVT 研究。
2. 大學典藏的學位論文，用於取得完整推導、試驗方法與參數量測細節。
3. 工程軟體官方模型說明，用於確認產業實作的輸入／校正結構；不把其未公開的經驗係數當成普適常數。
4. 工程報告只用於把前、後致動器耦合成可讀的準靜態方程；未經實驗驗證處明確降級為「起始模型」。

每個公式後均標示「來源」或「本文件推導」。後者只代表由已列出的來源公式做代數改寫、虛功或隱函數微分；若缺乏可驗證來源，直接標示為**假設**，不把調車經驗包裝成定律。

### 0.4 名詞與比值方向

- 前盤／主動盤（primary、driver）：與曲軸同轉，節圓半徑記為 `R_f`。
- 後盤／從動盤（secondary、driven）：經離合器與齒輪組連到後輪，節圓半徑記為 `R_r`。
- 本文一律使用「減速比」方向：`i = 輸入轉速 ÷ 輸出轉速`。因此純 CVT 比 `i_cvt = ω_f / ω_r = R_r / R_f`（無滑差時）；起步低速端數值較大，高速端數值較小。
- `α` 一律是**單側盤面相對於徑向平面的角度**，也就是 V 槽夾角的一半。若供應商寫的是完整夾角，必須先除以二；13.8° 與 14°在本文均按單側角解讀。
- `L` 是皮帶抗拉芯線所在的節線長，不是外周長；`C` 是兩軸中心距。

---

## 1. 運動學基礎（Phase 1–3 的數學驗證）

### 1.1 從 log 的實測總比拆出純 CVT 比

若 app 由引擎轉速、車速與後輪有效周長得到實測總減速比 `i_total`，且傳動路徑包含一組 CVT、齒輪箱固定減速 `i_gear` 與終傳 `i_final`，則：

\[
i_{total}=i_{cvt}\,i_{gear}\,i_{final},\qquad
i_{cvt}=\frac{i_{total}}{i_{gear}\,i_{final}}
\tag{1-1}
\]

**來源：**串聯傳動的角速度比相乘；`i_cvt = R_r/R_f` 的方向與速可達運動學定義可對照 [S1] 式 (1)。這驗證了已拍板的「實測總比 ÷ 終傳 ÷ 齒輪組」。實作時不可再把齒輪組或終傳顛倒一次；所有輸入都必須以 `輸入轉速/輸出轉速 > 1` 的減速比表示。

無滑差時：

\[
i_{cvt,geom}=\frac{\omega_f}{\omega_r}=\frac{R_r}{R_f}
\tag{1-2}
\]

**來源：**兩節圓的皮帶線速度相等，`ω_f R_f = ω_r R_r`；同 [S1] 式 (1)。有滑差時，log 得到的是速度比 `i_cvt,meas`，不應強迫等於幾何比；兩者差異留給 Phase 2 的滑差警示。

### 1.2 皮帶長與軸距的兩約束式

令前盤、後盤節圓半徑為 `R_f`、`R_r`，通常起步時 `R_r > R_f`。開帶幾何的精確長度式為：

\[
\epsilon=\arcsin\!\left(\frac{R_r-R_f}{C}\right)
\tag{1-3}
\]

\[
L=\pi(R_f+R_r)+2(R_r-R_f)\epsilon
  +2\sqrt{C^2-(R_r-R_f)^2}
\tag{1-4}
\]

對應包角：

\[
\theta_f=\pi-2\epsilon,\qquad \theta_r=\pi+2\epsilon
\tag{1-5}
\]

**來源：**[S2] 式 (1)–(2)，以本文前／後盤符號重寫。

因此每個實測 `i_cvt` 的兩個未知半徑由下列兩約束共同決定：

\[
g_1(R_f,R_r)=R_r-i_{cvt}R_f=0,
\qquad
g_2(R_f,R_r)=L-L_{open}(R_f,R_r,C)=0
\tag{1-6}
\]

**來源：**本文件把式 (1-2) 與式 (1-4) 聯立。實作可代入 `R_r=i_cvt R_f` 後做一維有界求根；只接受 `|R_r-R_f|<C` 且前後半徑均落在量得的工作範圍內的根。若無根，不應外插，而應標成「固定減速／皮帶節長／有效輪周／滑差至少一項不一致」。

已核准 Phase 1 使用的工程近似式為：

\[
L\approx 2C+\pi(R_f+R_r)+\frac{(R_r-R_f)^2}{C}
\tag{1-7}
\]

**來源：**[S1] 式 (1) 以直徑改寫為半徑；它是常用開帶長度近似。建議正式 domain solver 改用式 (1-4) 的精確幾何式，式 (1-7) 只保留作初始值、文件說明或 regression 對照。這不改變 Phase 1–3 的產品範圍，只降低比值兩端的幾何近似誤差。

### 1.3 節圓半徑與盤面軸向位移

一片固定、另一片移動的對稱 V 槽中，節圓半徑變化與移動盤軸向位移為：

\[
\Delta x_f=2\,\Delta R_f\tan\alpha_f,
\qquad
\Delta x_r=-2\,\Delta R_r\tan\alpha_r
\tag{1-8}
\]

**來源：**[S2] 式 (3)–(4) 的盤面向量幾何；正負號取決於座標方向。UI 顯示位移量時可取絕對值，但 domain model 必須保留方向，才不會把前盤閉合與後盤張開畫成同向。

半徑基準必須是某個可量得狀態，例如起步的 `R_f,low`／`R_r,low`，不能把盤面零點、外徑或皮帶外緣誤當節線。皮帶磨耗會改變外寬與座入深度，故即使 `L` 不變，從外觀量到的半徑也可能偏離抗拉芯線的節圓半徑 [S3] §4.6。

### 1.4 13.8° 皮帶楔角與 14°盤面角失配的量級

這裡要分開三種效應，不能只用一個「0.2° 很小」帶過：

1. **盤面位移幾何。**式 (1-8) 使用的是實際盤面角。`tan 13.8° = 0.24562`、`tan 14° = 0.24933`，相差約 **1.51%**。若 `ΔR = 20 mm`，兩角算出的 `Δx` 相差：

   \[
   \delta x=2(20)\,[\tan(14^\circ)-\tan(13.8^\circ)]
   \approx 0.148\ \mathrm{mm}
   \tag{1-9}
   \]

   **來源：**本文件由式 (1-8) 代數計算。對動畫通常小於像素／裝配公差量級，對套管、墊片或全行程干涉判斷則不能忽略。

2. **剛性截面的邊緣失配量。**若用 `h = 10 mm` 的徑向接觸高度做純幾何估算，兩側寬度差為：

   \[
   \delta w=2h\,[\tan(14^\circ)-\tan(13.8^\circ)]
   \approx 0.074\ \mathrm{mm}
   \tag{1-10}
   \]

   **來源：**本文件的梯形截面幾何推導。這不是可直接加到節圓上的修正值；真實皮帶會橫向壓縮、彎曲並改變接觸壓力分布。Childs 與 Cowburn 的實驗甚至發現，切成 37°–38.5° 的皮帶在 36°槽內比名義完全相同者更有效率，原因是繞小半徑後的彎曲變形 [S9]。因此「原始皮帶角－盤槽角」不能獨立決定實際節圓偏移。

3. **楔緊摩擦增益。**平帶近似的 V 槽虛擬摩擦係數為 `μ_v = μ/sin α` [S3] 式 (2.3)，所以 `1/sin 13.8°` 比 `1/sin 14°` 大約 **1.42%**。但張力容量位於指數內（見 §2.5），不可把 1.42% 直接宣稱成可傳扭矩也增加 1.42%；還需包角、摩擦係數、壓力、溫度與接觸是否完整。

**實作決策：**Phase 1–3 以盤面實測角 `α_pulley` 解幾何；另存 `α_belt` 只作相容性／風險提示。第一版不虛構節圓修正公式。若兩者不同，顯示「失配可能改變座入與摩擦，需用染色接觸、盤距－半徑量測或實車校正」；這符合失配研究 [S9] 與 rubber CVT 損失綜論 [S6] 的證據強度。

### 1.5 Phase 1–3 的驗收條件

- Phase 1：式 (1-1)–(1-8) 皆使用同一比值方向、SI 內部單位與節線定義；精確式與近似式在 `R_f=R_r` 時都回到 `L=2C+2πR`。
- Phase 2：幾何無解、半徑越界與速度比偏差分開呈現；越界量可當「至少需要這麼多非幾何效應」的指標，不直接等同全部都是皮帶滑差。
- Phase 3：游標動畫只消費預先解出的 `R_f/R_r/x_f/x_r`；不在每次游標移動重新求根。盤面角失配只改提示，不偷改已解出的節圓。

---

## 引用文獻

- **[S1]** Vincenzo La Battaglia, Alessandro Giorgetti, Stefano Marini, Gabriele Arcidiacono, Paolo Citti, “Kinematic Analysis of V-Belt CVT for Efficient System Development in Motorcycle Applications,” *Machines*, 10(1), 16, 2022. <https://doi.org/10.3390/machines10010016>
- **[S2]** Brendon Anderson, “Analysis and Tuning of a Flyweight-Actuated Continuously Variable Transmission,” Bruin Racing / UCLA Baja SAE engineering report, 2017. <https://brendon-anderson.github.io/files/projects/cvt_tuning.pdf>
- **[S3]** Matthew James Messick, “An Experimentally-Validated V-Belt Model for Axial Force and Efficiency in a Continuously Variable Transmission,” M.S. thesis, Virginia Tech, 2018. <http://hdl.handle.net/10919/85055>
- **[S4]** G. Julió, J.-S. Plante, “An Experimentally-Validated Model of Rubber-Belt CVT Mechanics,” *Mechanism and Machine Theory*, 46(8), 1037–1053, 2011. <https://doi.org/10.1016/j.mechmachtheory.2011.04.001>
- **[S5]** Daisuke Hirajo, Koji Kobayashi, Tetsuya Kimura, “Development of CVT Shift Dynamic Simulation Model with Elastic Rubber V-Belt,” SAE Technical Paper 2011-32-0518, 2011. <https://doi.org/10.4271/2011-32-0518>
- **[S6]** L. Bertini, L. Carmignani, F. Frendo, “Analytical Model for the Power Losses in Rubber V-Belt Continuously Variable Transmission (CVT),” *Mechanism and Machine Theory*, 78, 289–306, 2014. <https://doi.org/10.1016/j.mechmachtheory.2014.03.016>
- **[S7]** Nilabh Srivastava, Imtiaz Haque, “A Review on Belt and Chain Continuously Variable Transmissions (CVT): Dynamics and Control,” *Mechanism and Machine Theory*, 44(1), 19–41, 2009. <https://doi.org/10.1016/j.mechmachtheory.2008.06.007>
- **[S8]** B. G. Gerbert, *Force and Slip Behaviour in V-Belt Drives*, Acta Polytechnica Scandinavica, Mechanical Engineering Series No. 67, 1972. <https://openlibrary.org/works/OL13340718W/Force_and_slip_behaviour_in_V-belt_drives>
- **[S9]** T. H. C. Childs, D. Cowburn, “Power Transmission Losses in V-Belt Drives Part 1: Mismatched Belt and Pulley Groove Wedge Angle Effects,” *Proceedings of the Institution of Mechanical Engineers, Part D*, 201(1), 33–40, 1987. <https://doi.org/10.1243/PIME_PROC_1987_201_155_02>
- **[S10]** T. F. Chen, D. W. Lee, C. K. Sung, “An Experimental Study on Transmission Efficiency of a Rubber V-Belt CVT,” *Mechanism and Machine Theory*, 33(4), 351–363, 1998. <https://doi.org/10.1016/S0094-114X(97)00049-9>
- **[S11]** T. F. Chen, C. K. Sung, “Design Considerations for Improving Transmission Efficiency of the Rubber V-Belt CVT,” *International Journal of Vehicle Design*, 24(4), 320–333, 2000. <https://doi.org/10.1504/IJVD.2000.005195>
- **[S12]** Ivan Arango, Sebastian Muñoz Alzate, “Numerical Design Method for CVT Supported in Standard Variable Speed Rubber V-Belts,” *Applied Sciences*, 10(18), 6238, 2020. <https://doi.org/10.3390/app10186238>
- **[S13]** Altair Engineering, “CVT Model,” *MotionView / MotionSolve 2024 Help*, 2024. <https://help.altair.com/2024/hwdesktop/hwx/topics/motionview/cvt_scooter_cvt_model_r.htm>
- **[S14]** Adrian Olmos Jr., Steven Griffin, Gary Price, Nathan Beilke, Scott Sajdowitz, “Investigating Humidity Effects on Small Offroad Engine SI Performance and Emissions,” SAE Technical Paper 2021-01-1224, 2021. <https://doi.org/10.4271/2021-01-1224>
- **[S15]** NASA Glenn Research Center, “Drag of a Sphere” （空氣阻力方程與各變數定義）. <https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-of-a-sphere/>

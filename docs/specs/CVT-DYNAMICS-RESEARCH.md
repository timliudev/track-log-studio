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

## 2. 力平衡模型：給定轉速／扭矩，CVT 停在哪個比值

### 2.1 一個自由度的準靜態問題

以 `q = i_cvt = R_r/R_f` 為廣義座標。對任一候選 `q`，§1 的兩約束式會唯一給出 `R_f(q)`、`R_r(q)`，再由式 (1-8) 得 `x_f(q)`、`x_r(q)`。珠道位置、後盤彈簧壓縮量、扭力凸輪相對轉角與包角也因此都成為 `q` 的函數。

這種降成一個自由度的做法符合 [S1]「先建立 belt／roller position kinematics，再做 dynamics」的研究路徑，也符合 [S2] 把前後致動器透過單一平衡式耦合的結構。第一版採**準靜態**：每個 log 樣本視為鄰近穩態，不預測變速所需時間。

### 2.2 前盤：滾珠離心力經珠道轉成軸向力

單顆滾珠質量 `m_j`、質心到旋轉軸半徑 `r_j`、前盤角速度 `ω_f` 時，徑向離心力大小為：

\[
F_c=m_j r_j\omega_f^2
\tag{2-1}
\]

**來源：**旋轉座標的基本向心／離心力；[S2] §2.2 與 [S3] §9.4.1 均以此建立 flyweight force。

真正需要的不是把某個固定「珠道角」乘上 `F_c`，而是滾珠質心路徑 `r_j(x_f)` 的局部機械利益。忽略滾動阻力，以虛功寫成：

\[
F_{j,x}^{ideal}\,dx_f=F_c\,dr_j
\quad\Rightarrow\quad
F_{j,x}^{ideal}=m_j\omega_f^2 r_j(x_f)\frac{dr_j}{dx_f}
\tag{2-2}
\]

**來源：**[S3] 式 (9.2) 的 `m r (ΔD_R/ΔD_A) ω²` 在連續曲線極限下的寫法；`dr_j/dx_f` 即局部珠道斜率／機械利益。它也說明為什麼只輸入一個珠道角不足：曲線斜率隨行程改變時，調速特性也會改變 [S1]。

`N_j` 顆沿同一路徑的總理想軸向力：

\[
F_{f,roller}^{ideal}
=\omega_f^2 r_j(x_f)\frac{dr_j}{dx_f}\sum_{k=1}^{N_j}m_{j,k}
\tag{2-3}
\]

**來源：**本文件將式 (2-2) 對各珠相加。混珠在「幾何相同、都保持接觸」的前提下只看總質量；若不同直徑／slider 形狀改變質心路徑，不能只加總克數。

若前盤另有回位彈簧，其反力為：

\[
F_{f,spring}=F_{f0}+k_f x_f
\tag{2-4}
\]

**來源：**線性壓縮彈簧的 Hooke 定律；[S2] 式 (5)。一般速可達前普利盤可把 `F_f0=k_f=0`。

實際前盤可用軸向力先定義為：

\[
F_f=\eta_{r,dir}(x_f,\omega_f,T)F_{f,roller}^{ideal}-F_{f,spring}
\tag{2-5}
\]

其中 `η_r,dir` 是升檔／降檔可不同的珠道效率。**這是半經驗假設，不是文獻常數。**理想版可先設 1；要吸收滾珠滾動／滑動阻力、導板摩擦與磨耗，必須由實測校正，且不可允許負夾持力（未接觸時截為 0）。

### 2.3 後盤：大彈簧與扭力凸輪

先將大彈簧的組裝預載與行程分開：

\[
F_{r,spring}=F_{r0}+k_r x_r
=k_r(x_{r,pre}+x_r)
\tag{2-6}
\]

**來源：**[S2] §2.3 的 `k_s(δ_s,pre+z_s)`。型錄若只寫「1000 rpm／1500 rpm 彈簧」而沒有 N/mm 與安裝長度，不能直接代入此式。

令扭力凸輪接觸半徑為 `R_c`，凸輪角 `γ_c` 定義為溝槽切線相對**圓周方向**的角度，因此：

\[
\tan\gamma_c=\frac{dx_r}{R_c\,d\phi_c}
\tag{2-7}
\]

若假設從動盤扭矩平均分到兩片盤面，且大彈簧另有扭轉預載／扭轉剛性，凸輪增加的軸向力為：

\[
F_{r,cam}=\frac{\cot\gamma_c}{R_c}
\left[\frac{T_r}{2}+\kappa_r(\phi_{pre}+\phi_c)\right]
\tag{2-8}
\]

\[
\phi_c(x_r)=\int_0^{x_r}\frac{dx}{R_c(x)\tan\gamma_c(x)}
\tag{2-9}
\]

**來源：**[S2] 式 (7)–(8)；式 (2-9) 是其常角度關係對變角／變半徑溝槽的積分化。若大彈簧沒有可辨識的扭轉作用，設 `κ_r=0`。若供應商的凸輪角是相對軸向量測，需先轉成 `γ_c = 90° - γ_axis`；否則 `cot`／`tan` 會整個用反。

接觸 pin／roller 數量在「總扭矩平均分配」推導中會相消，不應再多乘一次。更重要的是，`T_r/2` 是簡化假設；Manes 的低功率 rubber-belt CVT 研究指出，螺旋約束兩盤面的扭矩分配會受盤面速度差、皮帶剪切剛性與摩擦係數強烈影響 [S16]。因此實作應把 `1/2` 泛化為可校正的負載分配 `λ_T`：

\[
F_{r,cam}=\frac{\cot\gamma_c}{R_c}
\left[\lambda_T T_r+T_{spring,torsion}\right],
\qquad 0<\lambda_T<1
\tag{2-10}
\]

**來源：**式 (2-8) 的半經驗擴充；`λ_T=0.5` 是 [S2] 的起始假設，其他值必須實測識別。

後盤總致動軸向力：

\[
F_r=F_{r,spring}+F_{r,cam}
\tag{2-11}
\]

**來源：**[S2] 式 (7) 的彈簧項與凸輪項相加。扭矩越高時 `F_r` 越大，會抵抗前盤升檔並增加夾持；這就是 torque cam 的負載回饋路徑。

### 2.4 前後盤如何透過皮帶耦合

[S2] 的最低階「均勻壓力」耦合把兩盤的單位包角壓力視為相同，可得 stationary clamp-force ratio：

\[
\frac{F_f}{F_r}=K_0(q)
=\frac{\theta_f(q)}{\theta_r(q)}
\tag{2-12}
\]

**來源：**[S2] 式 (9) 整理；`θ_f/θ_r` 由式 (1-5) 取得。這是可跑的起始模型，但不是 rubber V-belt 接觸力的完整解。

更可靠的工程結構是把皮帶、摩擦、扭矩與歷史效應濃縮成 stationary ratio map：

\[
K_{stat}=K_{stat}(q,T_r,\omega_f,T_{belt},dir,wear)
\tag{2-13}
\]

\[
\Psi(q;\omega_f,T_r,p)=F_f(q,\omega_f,p)
-K_{stat}(q,T_r,\ldots)F_r(q,T_r,p)=0
\tag{2-14}
\]

**來源：**[S13] 採用「實際夾持力比等於 stationary clamp force ratio 才停止變速」的 CMM 結構，且明示其中係數需實驗量測；式 (2-14) 是本文依該結構與式 (2-12) 的符號化。沒有台架資料時先令 `K_stat=K_0·k_cal`，以少量 log 校正無因次 `k_cal(q,T_r,dir)`，不可默認 `k_cal=1` 已達預測精度。

### 2.5 皮帶楔緊、可傳扭矩與滑差條件

最簡 V-belt capstan 上限為：

\[
\frac{T_{tight}-T_c}{T_{slack}-T_c}
\leq
\exp\!\left(\frac{\mu\theta}{\sin\alpha}\right),
\qquad T_c=m'v_b^2
\tag{2-15}
\]

**來源：**[S3] 式 (2.1)–(2.3)，彙整自 Gerbert [S8]；`T_c` 是皮帶線密度 `m'` 與皮帶速度 `v_b` 造成的離心張力。低速簡化可忽略 `T_c`，高速不應忽略。

盤上傳遞扭矩與緊、鬆邊張力差：

\[
T_{pulley}=(T_{tight}-T_{slack})R
\tag{2-16}
\]

**來源：**繞帶輪的力矩平衡；亦為 [S3] 接觸區模型的邊界量。若令 `E=exp(μθ/sinα)` 且恰在滑動極限、忽略 `T_c`，可由式 (2-15)–(2-16) 推得：

\[
T_{slack,min}=\frac{T_{pulley}/R}{E-1},
\qquad
T_{tight,min}=E\,T_{slack,min}
\tag{2-17}
\]

**來源：**本文件由式 (2-15)–(2-16) 代數推導。它是容量下限，不是軸向夾持力的完整公式。

若每片盤面對皮帶的局部法向壓力（每單位弧長）為 `p(s)`，移動盤承受的軸向反力為：

\[
F_{axial}=\int_{contact}p(s)\cos\alpha\,ds
\tag{2-18}
\]

**來源：**[S3] §3.1 與 §6.1.2 的盤面壓力積分。`p(s)` 同時受張力、座入／退出、彎曲剛性與徑向摩擦控制，所以僅靠 `μ` 和式 (2-15) 不能唯一算出 `F_f/F_r`。這正是第一版需要 `K_stat` 校正，而不直接宣稱完成接觸力學的原因。

log 可觀察的總速度滑差指標可定義為：

\[
s_{speed}=1-\frac{\omega_rR_r}{\omega_fR_f}
\tag{2-19}
\]

**來源：**本文件將無滑差條件 `ω_fR_f=ω_rR_r` 正規化。它混合了前盤、後盤、離合器、輪胎有效周長誤差與訊號延遲，不能單憑此值反推出唯一摩擦係數；[S10] 也把 speed loss 與 torque loss 分開量測，而非用單一速度比代表全部損失。

### 2.6 完整平衡方程與求解結構

給定前盤轉速 `ω_f`、傳遞到後盤的扭矩 `T_r` 與參數集合 `p`，第一版的求解順序為：

1. 在幾何允許區間 `[q_min,q_max]` 取候選 `q`，用式 (1-3)–(1-8) 解 `R_f/R_r/x_f/x_r/θ_f/θ_r`。
2. 由數位化的 `r_j(x_f)` 與導數，使用式 (2-3)–(2-5) 算 `F_f`。
3. 由大彈簧、凸輪曲線與 `T_r`，使用式 (2-6)–(2-11) 算 `F_r`。
4. 用式 (2-14) 找所有 `Ψ=0` 的根；若沒有內部根，依殘差方向停在 `q_min` 或 `q_max` 的機械端點。
5. 對每個根另外檢查式 (2-15)–(2-18) 的摩擦容量；容量不足時仍可回報幾何平衡根，但狀態必須是「預測會滑」，不能把它當有效穩態。
6. 若出現多根，需以升檔／降檔方向、上一樣本 `q_prev` 與局部穩定性選根。作為數值選根的**啟發式假設**，可設 `dq/dt=-cΨ`、`c>0`；則 `∂Ψ/∂q>0` 的根局部穩定。此式只用於選根，不宣稱預測真實變速時間。

若只有引擎輸出扭矩 `T_e`，可先用：

\[
T_r\approx\eta_{cvt}\,q\,T_e
\tag{2-20}
\]

**來源：**本文件由功率平衡 `T_eω_f η_cvt=T_rω_r` 與 `q=ω_f/ω_r` 推導。因 `η_cvt` 本身隨比值、夾持與滑差改變 [S6][S10]，這會形成需迭代的耦合；沒有量測效率時應輸出效率範圍造成的 band，不給假精確單線。

### 2.7 這個模型刻意不包含什麼

- 不解皮帶每一小段的位移、彎曲、阻尼與 stick/slip；[S4] 的實驗驗證瞬態模型為離散皮帶 ODE，[S5] 另用經 FEM／實驗驗證的簡化彈簧模型。兩者都證明瞬態不是再加一個 `μ` 就完成。
- 不假設升檔與降檔共用同一條曲線。橡膠遲滯、珠道摩擦、凸輪摩擦與皮帶溫度可造成方向依賴；第一版以 `dir` 分圖校正。
- 不把 roller weight、slider weight、不同直徑滾珠視為完全等價。式 (2-3) 只有在質心路徑相同時才可只看總重。
- 不以 capstan 式取代 `K_stat`。capstan 式是總滑動容量條件，無法描述接觸壓力沿包角的分布、徑向座入與局部微滑 [S3][S6][S8]。

---

## 3. 參數可得性與可辨識性分級

### 3.1 分級定義

| 級別 | 定義 | 可否作為預設可信輸入 |
|---|---|---|
| **A：型錄／直接量測** | 可由零件銘牌、齒數、卡尺、磅秤、角度規或簡單裝配量測取得 | 可以；仍須保存單位、量測方法與不確定度 |
| **B：幾何數位化** | 不是單一數字，需把輪廓、曲線或圖表轉成座標序列 | 可以，但必須保留原始點、平滑方法與有效行程；導數對雜訊敏感 |
| **C：受控實測校正** | 受摩擦、溫度、磨耗、裝配與方向影響，無可靠通用值 | 不可以跨車套用；只能當該車／該零件組合的 calibration |
| **D：單一 log 不可辨識** | 多個原因在觀測上等價，缺少額外感測或多組試驗無法拆開 | UI 不應要求使用者猜；只顯示合併殘差或範圍 |

分級重點不是「能不能查到一個數字」，而是該數字能否在式 (2-14) 中具有可重現的物理意義。[S3] 的實驗流程分別量皮帶軸向／彎曲／橫向剛性、幾何與動力計輸入；[S4][S5] 的驗證也都依賴專用試驗資料，支持這種分級。

### 3.2 A 級：銘牌或一般工具可取得

| 參數 | 建議取得方式 | 單位／注意事項 | 進入模型的位置 |
|---|---|---|---|
| 滾珠數 `N_j`、單顆重量 `m_j,k`、總重 | 每顆分開秤，再核對總重；至少 0.01 g 解析度 | 混珠要保存每顆分布，不只平均；slider 與圓珠分型 | 式 (2-3) |
| 滾珠外徑／形狀 | 卡尺＋型式選擇 | 形狀可能改變質心路徑，不能只當重量 | 決定 B 級 `r_j(x)` |
| 前後盤最小／最大工作半徑 | 盤面記號法、拆車量測或已知全行程 | 量到的是皮帶外緣時須換到節線；保存量測基準 | `q_min/q_max`、幾何越界 |
| 軸距 `C` | 量兩軸中心 | 熱態與懸吊作動通常不改，但引擎吊架變形可列不確定度 | 式 (1-3)–(1-7) |
| 盤面半角 `α_f/α_r` | 角度規、輪廓儀或可信圖面 | 確認是單側角，不是完整 V 槽角 | 式 (1-8)、(2-15)、(2-18) |
| 皮帶節線長 `L`、寬、高、名義楔角 | 優先用製造商 pitch length；其次依抗拉芯線位置量測 | 外周長不可直接當 `L`；磨耗寬度另存 | §1 幾何、接觸風險 |
| 齒輪組與終傳 | 直接數齒或維修手冊 | 一律轉成輸入／輸出減速比 | 式 (1-1) |
| 套管／boss 長度、墊片厚度 | 千分尺／卡尺 | 是行程與端點幾何，不是直接的離心力參數 | `x_f` 零點與上限 |
| 大彈簧自由長、線徑、圈數 | 卡尺／型錄 | 只能作交叉檢查，不能取代 force–length 曲線 | 式 (2-6) 的先驗 |
| 大彈簧剛性 `k_r`、安裝長／預壓縮 | 有 N/mm 型錄＋實際安裝長，或簡單壓床量測 | `F_r0 = k_r(l_free-l_installed)` 僅在線性區成立；來源為式 (2-6) 的 Hooke 關係 | 式 (2-6) |
| torque cam 名義角、接觸半徑 | 圖面或拆件量測 | 必須記錄角度基準（圓周向或軸向） | 式 (2-7)–(2-10) |
| 後輪有效周長 | 負載滾行一圈或多圈平均 | 胎壓、傾角與滑移會影響；輪胎規格換算只作初值 | `i_total` |
| 引擎 torque／power curve | 同車同設定馬力機，次選原廠曲線 | 進排氣、ECU、溫度不同不可沿用 | 式 (2-20)、逆向求解 |

「大彈簧 +1000 rpm」「1500 rpm」或品牌的百分比硬度不是 `k_r`，也沒有跨品牌共同基準。可作使用者備註／catalog ID，不能直接塞進 N/mm 方程。

### 3.3 B 級：必須數位化的曲線

#### 滾珠質心路徑 `r_j(x_f)`

這是前盤力模型最關鍵、也最容易被漏掉的輸入。[S1] 把 roller curved ramp 與 belt position 的關聯列為速可達 CVT 設計核心；[S3] 以 CAD 取得 flyweight radius 與盤面行程，再用局部位移比算軸向力。

建議數位化方式依可信度排序：

1. CAD／原廠輪廓：直接匯出滾珠**質心**在每個盤面軸向位置的 `(x_f,r_j)`。
2. 拆件攝影：相機光軸垂直剖面、畫面內放比例尺與兩個以上基準點，校正透視後描點；需把接觸輪廓按滾珠半徑做法向偏移，得到質心路徑。
3. 實體分段量測：在數個已知盤距固定滾珠，量其質心半徑。

模型使用 `dr_j/dx_f`，所以禁止直接對稀疏／帶鋸齒的描點做差分。應保存原始點，另產生單調且至少一階連續的擬合曲線；若擬合在某段令 `dr_j/dx_f < 0` 或產生超出原始輪廓的振盪，標為無效。平滑程度造成的結果差應進入 sensitivity band，而不是藏起來。

#### 扭力凸輪 `γ_c(x_r)` 與 `R_c(x_r)`

直線溝可用單一角度與半徑；曲線 torque driver 必須數位化 pin 中心路徑，從局部切線取得式 (2-7) 的角度。若溝槽有明顯升／降檔不同接觸側，兩側輪廓都要量，否則無法表現遲滯。角度接近 0° 時 `cot γ_c` 對誤差極敏感，這些點需以實體行程／干涉條件驗證。

#### 非線性彈簧與引擎曲線

- 漸進式彈簧、會 coil-bind 的彈簧，改存 `F_spring(x_r)` 表，不硬套單一 `k_r`。
- 馬力機圖若只有圖片，數位化 `T_e(rpm,throttle)` 或至少 WOT `T_e(rpm)`；不要從 power 曲線讀值後忘記換算為 torque。
- 所有曲線資料均需保存來源、環境溫度、零件編號、有效區間與取樣日期。

### 3.4 C 級：只能對該車實測校正

| 參數／函數 | 為何不能可靠查表 | 最小校正試驗 |
|---|---|---|
| `K_stat(q,T_r,dir,T_belt)` 或 `k_cal` | 包含皮帶座入、壓力分布、徑向微滑與盤面摩擦；[S13] 明示需實驗係數 | 固定零件，至少三種穩定負載，分升檔／降檔慢掃；同步 RPM、後盤速度、扭矩與比值 |
| 珠道效率 `η_r,dir` | 導板、珠殼、潤滑／粉塵、珠面磨耗都會改變 | 拆下皮帶量盤面軸向力－RPM－行程，或與已知後盤負載共同識別 |
| 扭矩分配 `λ_T` | 螺旋約束兩盤面不必 50/50，且依速度差、皮帶剪切與摩擦變化 [S16] | 有後盤扭矩與軸向力感測的台架；無台架時只給 0.5 附寬不確定帶 |
| `μ_static/μ_kinetic` | 橡膠摩擦不是材料常數，受溫度、壓力、滑速、表面與磨耗影響 [S3][S6][S8] | 同皮帶／盤面材質 coupon test，或多扭矩 slip-onset 試驗；不可由單次一般騎乘直接反推 |
| 速度滑差／滑差 onset map | log 的總速度差混合皮帶、離合器、輪胎與訊號延遲 | 離合器鎖定後，以主／從動軸轉速與盤面位置同步量測；多負載重複 |
| 有效節線長與橫向剛性 | 熱、磨耗與座入使幾何有效值偏離名義值；[S3] 專門做橫向壓縮試驗 | 冷／熱態盤距－節圓量測，或已知盤距的橫向壓床試驗 |
| 升降檔遲滯／時間常數 | 由皮帶阻尼、摩擦、轉動慣量與致動器速度共同造成 | RPM／扭矩階躍或慢掃試驗；準靜態版只存方向差，不擬合真實時間 |
| 溫度修正 | 皮帶、彈簧、摩擦與引擎輸出同時改變 | 冷車、穩定熱車、不同環境溫度重複相同 protocol |

### 3.5 D 級：單一 Track Log 無法分離的量

| 觀察到的現象 | 至少有這些等價原因 | app 能誠實回報的內容 |
|---|---|---|
| `i_cvt,meas` 超出幾何界限 | 固定減速輸錯、輪周錯、節長／半徑界限錯、離合器滑、皮帶滑、RPM／speed 延遲 | 越界百分比與候選原因；不能直接命名為「皮帶滑差」 |
| 同珠重變速 RPM 偏高 | 大彈簧力較大、torque cam 力較大、珠道效率低、引擎／道路負載高、皮帶溫度不同 | 以 residual 顯示「所需前盤力比模型高／低」；需控制變因試驗 |
| 同速度 RPM 飄動 | throttle／引擎 torque 變、風坡負載、torque cam、離合器、輪胎滑、CVT 瞬態 | 與油門、加速度、坡度、升降檔方向交叉標記；不把全部歸因於珠重 |
| 傳動效率下降 | 皮帶彎曲／壓縮遲滯、徑向摩擦、gross slip、軸承／齒輪、離合器 | 只有引擎與輪端同步 torque 才能分配損失；一般 log 只報總體跡象 |

這類參數若讓使用者在 UI 直接輸入一個「猜測值」，會產生看似精密、實際不可驗證的輸出。較好的產品行為是允許「未校正」狀態，用範圍／灰色帶顯示，並列出下一個最有資訊量的量測。

### 3.6 建議的 calibration 資料鍵

所有 C 級資料應綁定下列 identity，避免把某條校正曲線錯套到另一組零件：

- 車輛／引擎設定 ID、ECU map、輪胎與胎壓。
- 前盤型號、珠型與每顆重量序列、套管／墊片組合。
- 後盤型號、大彈簧 ID／安裝預壓、torque cam 溝槽 ID。
- 皮帶品牌／料號、累積里程、冷態寬度、測試前後溫度。
- 測試日期、氣壓／氣溫／濕度、賽道／台架、升檔或降檔方向。

只要任一主要 identity 改變，舊 calibration 可作比較先驗，但狀態必須降回「未驗證」，不能悄悄沿用。

---

## 4. 敏感度分析：從零件變更到 `Δrpm`

### 4.1 先定義「變速轉速」在哪個 operating point

「換 1 g 會差幾 rpm」若沒有指定比值、負載、油門與升／降檔方向，並不是單一物理常數。本文定義三種可重現輸出：

1. **定比值敏感度**：在指定 `q*`、後盤扭矩 `T_r*`、方向與溫度下，求式 (2-14) 的平衡轉速 `n_f*`。
2. **全行程調速曲線**：對 `q` 的 10/25/50/75/90% 行程各求 `n_f(q)`，顯示零件變更後整條曲線，不只報一個平均。
3. **實測工況敏感度**：以某圈 log 的 `(T_r(t),q(t),dir(t),weather)` 重播模型，報中位數、10–90 percentile 與區段圖。

UI 的「珠重總重 ±1 g → 變速轉速 ±Δrpm」應預設使用第 2 種並明列基準，例如「50% 行程、後盤 12 N·m、熱車升檔」；否則不同人得到的數字不可比較。

### 4.2 隱函數敏感度

平衡由 `Ψ(q,ω_f,T_r,p)=0` 定義。在固定 `q*` 與 `T_r*` 下，任一參數 `p_k` 對平衡轉速的局部敏感度為：

\[
\frac{\partial\omega_f^*}{\partial p_k}
=-\frac{\partial\Psi/\partial p_k}{\partial\Psi/\partial\omega_f}
\tag{4-1}
\]

**來源：**本文件對式 (2-14) 做隱函數微分。若分母接近 0，代表平衡曲線近水平／可能在分岔或端點附近，局部 `rpm/unit` 會爆大；此時 UI 應顯示「非線性／端點敏感」，不可只顯示一個巨大數字。

數值上可用有界中央差分：

\[
S_{p_k}\approx
\frac{n_f(p_k+\Delta p_k)-n_f(p_k-\Delta p_k)}{2\Delta p_k}
\tag{4-2}
\]

**來源：**式 (4-1) 的二階中央差分近似。每個擾動點都要重新解完整平衡與摩擦容量，而非把原曲線上下平移。若 `p_k±Δp_k` 超出物理界限，改用單邊差分並標示。

### 4.3 珠重 `±1 g` 的解析基準與 200 rpm/g 對照

若固定 `q/T_r`、忽略摩擦與前盤彈簧，式 (2-3) 可寫成 `F_f=A(q)M_jω_f²`；平衡所需前盤力 `B` 固定時：

\[
\omega_f^*=\sqrt{\frac{B}{A(q)M_j}},
\qquad
\frac{\partial n_f^*}{\partial M_j}
=-\frac{n_f^*}{2M_j}
\tag{4-3}
\]

**來源：**本文件由式 (2-3) 與式 (2-14) 在上述簡化假設下推導。它提供量級 sanity check：珠重增加，平衡轉速下降；而且關係是反平方根，不是全域線性。

例：總珠重 `M_j=54 g`、基準 `8000 rpm` 時，式 (4-3) 的局部斜率約為 **−74 rpm／總重 g**。若六顆都各加 1 g（總重加 6 g），精確反平方根估計為：

\[
\Delta n=8000\left(\sqrt{54/60}-1\right)\approx-410\ \mathrm{rpm}
\tag{4-4}
\]

**來源：**式 (4-3) 代數計算；只作量級例，不是特定車種預測。

因此「實務約 200 rpm/g」必須先釐清 `g` 的定義：

- 若指**整組總重**增加 1 g，54 g／8000 rpm 的理想基準只有約 74 rpm/g；實測 200 表示 `K_stat`、珠道效率、負載、量測區段或端點效應顯著，應以 calibration 覆蓋理想斜率。
- 若指常見口語「每顆由 9 g 換成 10 g」，六珠總重其實增加 6 g；理想量級約 410 rpm，而實測 200 rpm 並不矛盾，因後盤力、珠道斜率與行程都在變。

產品輸入與報表必須同時顯示「單顆標稱重量」「顆數」「總重變化」，禁止只寫 `±1 g`。建議曲線同時畫：理想 `M^{-1/2}` 虛線、完整模型實線、實測點；200 rpm/g 作對照標記，不作預設校正常數。

### 4.4 全域 sweep 與不確定度帶

局部導數只適合小變更。實際零件建議用：

1. 對珠重、彈簧預載、`k_r`、凸輪角、套管長度逐項掃描實際可購／可裝值。
2. 每組在完整 `q` 網格與至少低／中／高三個 `T_r` 求解式 (2-14)。
3. 對 C 級參數（`K_stat/η_r/λ_T/μ`）使用校正分布或上下界重算，輸出中位線與 10–90% band。
4. 檢查每點是否超出盤徑／行程、彈簧 coil-bind、珠道端點或式 (2-15) 摩擦容量。
5. 將升檔、降檔分開；兩條線間距就是模型可表達的遲滯，不用一條平均線掩蓋。

推薦輸出：`rpm vs q`、`Δrpm vs total roller mass`、`slip margin vs torque`、`q endpoint vs sleeve length`，另附「最敏感參數 tornado chart」。只有在參數範圍與 operating point 相同時，才比較不同 setup 的斜率。

### 4.5 套管長度的影響路徑

套管／boss 長度首先是**幾何邊界參數**，不是像珠重一樣直接進入 `m r ω²`：

```text
套管／墊片厚度
  → 前盤最小間隙、可閉合行程與 x_f 零點
  → R_f,min / R_f,max 與可達 q 範圍
  → 同一 q 對應的滾珠位置 r_j(x_f)、局部斜率 dr_j/dx_f
  → 前盤軸向力 F_f 與平衡 rpm
```

若只是端點 stop 改變，行程中段的變速轉速可能幾乎不變，只改低速端／高速端能否到達；若整個移動盤相對珠道導板的零點也被改變，同一 `q` 會落在不同珠道斜率，才會改整條調速曲線。不同總成的墊片位置與受力路徑不同，故不設定「加長一定升 rpm／降 rpm」的通則；需量 `x_f` 零點與端點後再跑 §4.4 sweep。

### 4.6 天氣與溫度的影響路徑

乾空氣的一階密度可用：

\[
\rho=\frac{p_{atm}}{R_{air}T_{air}}
\tag{4-5}
\]

**來源：**NASA Glenn 的 ideal-gas equation of state [S17]；`T_air` 必須用 K。濕度高時水氣改變混合氣密度，第一版可用天氣服務提供的 density，或標示「乾空氣近似」。

速可達與騎士的空氣阻力：

\[
F_{aero}=\frac12\rho C_dA\,(v-v_{wind})^2
\tag{4-6}
\]

**來源：**NASA Glenn drag equation [S15]，相對風速改寫。縱向輪端需求可寫成：

\[
F_{road}=ma+mg\sin\beta+C_{rr}mg\cos\beta+F_{aero}
\tag{4-7}
\]

**來源：**車輛縱向 Newton 平衡，參考 Jazar [S18] 的 longitudinal dynamics；未量坡度、風與 `C_dA/C_rr` 時應標成估計。

力平衡的天氣路徑為：

```text
氣壓／氣溫／濕度 → 空氣密度 ρ → 空阻 → 輪端需求扭矩
→ 後盤 T_r → torque-cam 軸向力 → 所需前盤離心力 → 平衡 rpm
```

定壓下升溫會降低 `ρ` 與同速空阻，單看負載路徑會降低 torque-cam 反力；但同時還有三條方向未必相同的路徑：

- 進氣密度／濕度改變小型 SI 引擎可用 torque；Olmos 等人的小型引擎試驗甚至指出通用 SAE J1349／濕度修正未必完全補償特定引擎 [S14]。
- 皮帶本體溫度改變橫向剛性、遲滯與摩擦；[S3] 的材料值與橫向剛性即分室溫／60°C 處理。
- 大彈簧與盤面溫度、皮帶磨耗會改預載與 `K_stat`，其量級需實測。

因此 app 應把 `T_air`（環境）、`T_belt`（皮帶／CVT 箱）與 engine correction 分開。沒有 `T_belt` 感測時，只能以「冷車／熱車」類別或騎乘時間代理，不能聲稱由氣象溫度直接得到皮帶摩擦係數。

### 4.7 敏感度結果的驗證門檻

- 至少保留一組未參與校正的珠重或彈簧 setup 作 hold-out；只有 hold-out 的 `rpm(q)` 誤差也在容許範圍內，才可稱為預測。
- 報告需同時列絕對誤差、方向是否正確、升／降檔差與滑差警示；只命中一個「變速 rpm」不足以驗證模型。
- 若模型對總重 1 g 預測 70 rpm、實測 200 rpm，不得把實測點刪掉或偷偷重定義單位；應把差異歸入 `K_stat/η_r/load` 的識別工作。
- 每次換皮帶、torque cam、套管位置或大彈簧，依 §3.6 降級 calibration，重新驗證。

---

## 5. 逆向調教求解的可行性與限制

### 5.1 先拆成兩個不同機構的目標

使用者目標「起步接合在最大扭力轉速、之後定在最大馬力轉速不飄不掉」包含兩個不同子系統：

1. **起步離合器接合**由後離心離合器的蹄塊質量、重心半徑、蹄片小彈簧、槓桿幾何、鼓徑與摩擦決定。珠重／大彈簧會改接合過程中的負載與引擎爬升，但不能取代 clutch-shoe model。[S19] 的離心離合器研究也把接合轉速對 spring constant、spring compression、guide/pad mass 的敏感度分開分析。
2. **離合器鎖定後的 CVT 變速平台**才由 §2 的前盤滾珠、大彈簧、torque cam 與皮帶平衡決定。

離合器初接觸可抽象為另一條根方程：

\[
G_{clutch}(n;,m_{shoe},r_{shoe},k_{shoe},preload,geometry)=0
\tag{5-1}
\]

**來源：**離心蹄塊的 `m r ω²` 與彈簧反力平衡；參數結構參考 [S19]。精確式取決於特定蹄塊槓桿與彈簧掛點，未量幾何前不展開成假通式。

故若候選變數只有「珠重＋大彈簧」，要求 `n_engage = n_peak_torque` 是**控制權不足的不可行約束**。app 應回覆「需加入離合器小彈簧／蹄塊參數」，而不是硬推薦一組珠重。

### 5.2 目標轉速的正確語意

- `n_peak_torque`：由同車同設定馬力機 torque curve 找最大扭矩點，可作離合器開始／完成接合的候選，但必須同時檢查滑摩熱與可控性；接合不是瞬間鎖死。
- `n_peak_power`：適合定義**全油門加速期間的變速平台**。若「巡航」是指固定車速、部分油門道路巡航，把引擎維持最大馬力轉速通常不是相同目標；此時應用部分油門效率／油耗 map，而非 WOT power peak。
- 「不飄不掉」應量化為 `q` 與負載範圍內的最大允許轉速帶，例如 `n_target ±150 rpm`。純被動 CVT 同時含 `ω²` speed feedback 與 `T_r` torque feedback，不可能在所有坡度、風、油門、溫度與升降檔歷史下精確維持單一 rpm。

### 5.3 前向模型轉成反問題

令可調設計向量為：

```text
x = {
  roller masses / arrangement,
  contra-spring catalog ID and preload,
  torque-cam catalog ID,
  sleeve / shim configuration,
  optional clutch-shoe spring ID and preload
}
```

對每個代表工況 `j`（比值、後盤扭矩、方向、溫度），前向模型給出 `n_eq,j(x)`。最基本的加權最小平方目標：

\[
J(x)=\sum_j w_j\left[n_{eq,j}(x)-n_{target,j}\right]^2
+w_sP_{slip}(x)+w_bP_{bounds}(x)+w_cP_{change}(x)
\tag{5-2}
\]

**來源：**本文件依 §2 前向平衡與 [S2]「由 equilibrium equation 反求 desired engine speed 的 flyweight mass」擴充成多工況受限最佳化。[S12] 也採從道路、車輛與期望性能逐步設計 mechanical centrifugal actuator 的數值方法。

各 penalty 的產品語意：

- `P_slip`：式 (2-15) 容量不足、預測 gross slip 或 clutch 長時間滑摩即快速增加。
- `P_bounds`：無法涵蓋要求的起步／高速 `q`、盤面干涉、滾珠／凸輪超行程、彈簧 coil-bind。
- `P_change`：偏好離目前已驗證 setup 較近、少換零件的方案，避免數學上等效但維護成本高的答案。

若要求對天氣與負載都「不飄」，應做 robust optimization：

\[
\min_x\ \max_{s\in\mathcal S}
\left|n_{eq}(x;s)-n_{target}(s)\right|
\tag{5-3}
\]

**來源：**本文件把式 (5-2) 改成場景集合 `S` 上的 minimax；場景由 §4.4／§4.6 的低中高負載、冷熱、升降檔與參數不確定度組成。輸出是「最壞情況仍在 ±Δrpm」的候選，而非名義天氣下一個漂亮點。

### 5.4 離散零件與連續參數的求解方式

珠重可有離散 0.25/0.5 g 級距，大彈簧與 torque cam 通常是 catalog part，套管／墊片也有可裝組合；因此不是單純對連續函數求導。建議結構：

1. 枚舉實際買得到、幾何相容的 spring／cam／sleeve／clutch-spring 組合。
2. 每組先用式 (4-3) 或式 (5-2) 估連續最佳總珠重，再投影到可配出的單顆重量與混珠排列。
3. 用完整 `K_stat`、摩擦容量與 §4 場景重算每個離散候選。
4. 移除違反硬約束者，對剩餘方案按 nominal error、worst-case error、slip margin、改裝量與 calibration confidence 排 Pareto front。
5. 最終只推薦 2–5 組可實測候選，並明列下一輪 A/B test（例如只改總珠重，其他不動）。

[S2] 指出在其單點、固定其餘量的式 (9) 中，flyweight mass 可顯式反解；同一報告也把實驗驗證、真實非線性 ramp／helix、摩擦與 transient response 列為後續工作。這恰好界定 app 可做的是「縮小試裝範圍」，不是跳過調車。

### 5.5 為何反解通常不唯一

以下變更都可能把同一工況的平衡 rpm 推向相同方向：

- 減輕珠重；
- 增加大彈簧預載／剛性；
- 換更有機械利益的 torque cam 區段；
- 改變珠道斜率或其有效摩擦；
- 增加道路／馬力機負載；
- 改變套管後，讓同一 `q` 落在另一個珠道位置。

所以只有一條 `rpm vs speed` 曲線時，未知數數量通常大於獨立資訊量。可辨識的做法是先鎖 A/B 級幾何、用基準 setup 校正 C 級 map，再每次只改一項。若同時換珠、彈簧、cam 與皮帶，反問題應標成 underdetermined，不產生「唯一最佳組合」。

### 5.6 建議結果格式

每個候選應回報：

- 離合器初接觸／近鎖定轉速（只有 clutch 參數齊全時）。
- WOT 變速平台 `rpm(q)`，低／中／高負載及升／降檔分線。
- 相對 `n_peak_power` 的平均、最大偏差與不確定帶。
- 起步與高速可達比值、套管／盤徑／彈簧行程 margin。
- 式 (2-15) 的 slip margin 與哪些點依賴未知 `μ`。
- 推薦理由、相對目前 setup 的單項變更、必做的實車驗證。
- confidence：`幾何`、`準靜態未校正`、`已校正`、`hold-out 已驗證` 四級。

### 5.7 不可承諾的輸出

- 沒有離合器幾何／小彈簧資料時，不反推接合 rpm。
- 沒有 baseline calibration 時，不以個位數 rpm 或 0.1 g 精度推薦。
- 沒有 torque／throttle／坡度資訊時，不把賽道 rpm 波動全解釋成 CVT 調校。
- 被動零件無法保證任何天氣、任何負載、任何磨耗下「完全不飄不掉」；只能在已定義場景內最小化偏差。
- 逆解不能保證耐久、皮帶溫度與離合器熱負荷安全；需另有製造商極限與實車熱測。

---

## 6. Track Log Studio 實作建議

### 6.1 產品原則

1. **實測曲線是事實層，模型是解釋層。**既有 `i_total`／`i_cvt,meas` 曲線永遠保留；模型失配時顯示 residual，不用模型覆蓋 log。
2. **幾何、力平衡、校正、逆向建議逐級解鎖。**缺資料時停在上一級，畫面仍可用，不要求使用者為了通過表單而猜 `μ`。
3. **所有 prediction 帶 confidence 與適用工況。**至少區分「純幾何」「理想未校正」「本車已校正」「hold-out 已驗證」。
4. **不把自由文字調教備註自動當物理參數。**「大彈簧 1500 rpm」可保存與比較，但在沒有 N/mm／安裝預載前不能進式 (2-6)。
5. **所有重計算預先完成／快取。**比值求根、force sweep、Monte Carlo 與 calibration 不在 cursor move 上執行；Phase 3 SVG 只讀樣本對齊的結果。

### 6.2 已核准的純運動學 Phase 1–3（範圍不變）

#### Phase 1 — CVT profile 與 belt-position solve

- per-profile：皮帶節線長 `L`、軸距 `C`、前後盤面半角、前後工作半徑／套管行程、齒輪組、終傳與後輪有效周長。
- derived：`i_cvt = i_total ÷ i_gear ÷ i_final`；以式 (1-4)＋式 (1-6) 解節圓，式 (1-8) 解盤面位移。
- 建議以精確開帶式為正式值，式 (1-7) 保留為已核准近似式的 regression 對照。

#### Phase 2 — 幾何界限與 slip suspicion

- `i_cvt,meas` 導致無根或半徑越界時，顯示超額百分比、離合器未鎖定 gating 與候選原因。
- fixed reduction 未知時，可用已確認「離合器鎖定、穩態、高速端到位」區段回推；結果必須標為 calibration fallback，並顯示所選區段。
- 用詞建議「非幾何速度差／疑似滑差」，不可把所有越界直接定名為皮帶 slip（§3.5）。

#### Phase 3 — cursor-synced SVG CVT animation

- side view 前後盤、皮帶梯形、移動盤與 slipping state。
- 盤面位置只由預算好的 `R_f/R_r/x_f/x_r` 驅動；若角度失配，只顯示接觸風險提示。
- 同步顯示 measured total ratio、pure CVT ratio、幾何可達範圍與 confidence；輪周／固定減速不確定度常駐可見。

### 6.3 Phase 4 — 準靜態 force-balance sandbox

**目的：**讓進階使用者輸入可量得參數，看到每個機構的力曲線與平衡結構；此階段不先推出「推薦珠重」。

#### 最小參數集

| 群組 | 必填 | 可先採假設／缺省 | 缺少時的行為 |
|---|---|---|---|
| Phase 1 幾何 | `L/C/α/R bounds/x reference/fixed ratios` | 無 | 不開 force model |
| 前盤 | 珠數、每顆重量；`r_j(x_f)` 數位化點 | `η_r=1`，清楚標理想 | 沒珠道曲線時只畫 `m r ω²`，不解 axial equilibrium |
| 後盤彈簧 | force–travel curve，或 `k_r + installed preload` | 無；「rpm rating」不轉換 | 沒物理彈簧力時不解平衡 |
| torque cam | `γ_c(x_r)`、`R_c(x_r)`、角度基準 | `λ_T=0.5` 附寬不確定帶；無扭轉彈簧則 0 | 無 cam 時可做 `T_r=0` 教學情境，負載預測停用 |
| 操作工況 | `ω_f`、`T_r` 或可追溯的 torque estimate | `η_cvt` 只能是範圍 | 沒 torque 時只比較無負載／指定假設負載 |
| 皮帶耦合 | `K_stat` calibration 或選擇 ideal `K_0` | `K_0=θ_f/θ_r`，confidence=理想未校正 | 可解示意根，不可稱實車預測 |

摩擦係數 `μ` **不是求式 (2-14) 理想平衡根的必填欄位**；它是 slip-capacity 檢查必填或範圍輸入。這可避免使用者為了「跑得動」亂填一個看似精密的 0.4。若未填，只顯示「尚未評估 slip margin」。

#### UI 表單

1. **Profile／零件 identity**：車輛、前盤、珠型、後盤、大彈簧、cam、皮帶、套管／墊片；可複製 setup 做 A/B。
2. **幾何**：沿用 Phase 1，額外顯示節線與外周長的差別、單側角／完整槽角切換。
3. **前盤滾珠**：顆數、逐顆 g、總重自動加總、圓珠／slider、`(x_f,r_j)` 點表／CSV、輪廓預覽與導數預覽。
4. **後盤彈簧**：自由長、安裝長、N/mm 或 force–travel 點表；表單即時顯示 `F_r0` 與剩餘 coil-bind margin。
5. **Torque cam**：角度基準明選、接觸半徑、常角或曲線點表、是否有扭轉預載、`λ_T` 假設／校正狀態。
6. **皮帶／摩擦**：料號、里程、冷態寬、楔角、`μ` 範圍、belt temperature；與盤角失配提示。
7. **工況**：固定 torque sweep、從 dyno curve 估算或從 log 選區段；顯示 torque 的來源鏈與不確定度。

#### 輸出

- `F_f`、後盤大彈簧力、torque-cam force、`K_stat F_r` 對 `q` 的分解圖。
- `Ψ(q)` 與根、機械端點、多根／不穩定根提示。
- `rpm(q)` 的低中高 torque band，升／降檔分線。
- 盤徑、珠道、凸輪、彈簧行程 margin。
- 有 `μ` 時的 slip-capacity margin；沒有時顯示待量測，不補數字。

### 6.4 Phase 5 — 本車校正與敏感度

**進入條件：**至少有一個 baseline setup，log 具 RPM、speed、有效輪周、固定減速與可用的 throttle／torque proxy；最好另有從動軸速度、CVT 溫度與 dyno torque。

- 使用者選「穩態、離合器已鎖、無明顯煞車／輪滑」的校正區段；app 應保存選段，不自動挑完便藏起來。
- 先識別低維 `k_cal(q,T,dir)` 或幾個分段係數，不一開始就同時擬合 `μ/η_r/λ_T/L/wheel circumference`。
- 顯示 fitted 與 hold-out residual、參數相關性與是否 underdetermined；hold-out 不合格則 confidence 不升級。
- 開放 §4 的 total roller mass `±1 g`、spring preload、`k_r`、cam、sleeve、weather sweep；同時輸出 nominal line 與 uncertainty band。
- calibration 要綁 §3.6 identity；零件變更後自動降級，不刪舊資料，方便 setup 比較。

### 6.5 Phase 6 — 受限逆向調教助手

**進入條件：**Phase 5 至少一個 hold-out 驗證通過，並建立實際可取得零件 catalog。

- 目標分「離合器接合」「WOT 變速平台」「高速端／低速端」「slip／熱負荷 margin」；缺 clutch 參數時第一項停用並解釋原因。
- 依 §5.4 枚舉離散零件＋微調珠重，輸出 Pareto 候選，不輸出單一神奇答案。
- 每個候選列低中高負載、冷熱、升降檔最壞誤差，並產生「只改一項」的實車驗證卡。
- 使用者回填實測結果後新增 calibration revision；不可直接改寫舊模型而失去可追溯性。

### 6.6 Phase 7 — 暫不排程的瞬態研究

若日後確實需要 `shift time`、belt temperature／loss 或 stick-slip，應另立研究：

- 皮帶縱向、橫向與彎曲剛性、阻尼、線密度、熱態材料曲線。
- 離散 belt element／ODE 或經實驗驗證的 1-D spring/contact model [S4][S5]。
- 主從動盤慣量、離合器動態、局部接觸與摩擦模型。
- 專用台架與高速量測。

不要在 Phase 4–6 加一個任意 low-pass time constant，就把輸出命名為「真實變速時間」。若只為 UI 動畫平滑，可用視覺 easing，但必須與物理預測欄位隔離。

### 6.7 資料通道與降級策略

| 可用通道 | 能啟用的能力 | 缺少時 |
|---|---|---|
| Engine RPM + GPS／wheel speed | measured total ratio | 核心功能不可用 |
| 有效輪周 + fixed ratios | pure CVT ratio | 只顯示 total ratio 或 calibration fallback |
| Throttle | 區分 WOT／部分負載、升降檔區段 | torque 情境需手動選 |
| Longitudinal acceleration + grade | 改善 road-load torque estimate | 以 torque range 代替 |
| Dyno engine torque map | `T_e → T_r` estimate | 不反解實車 torque，只做指定 sweep |
| Driven shaft RPM | 分離 CVT speed ratio 與後輪／終傳誤差 | 所有速度差仍是合併 residual |
| Clutch bell／output RPM | clutch slip 與 lock-up gating | 只能用轉速／速度形狀推測 lock-up |
| Belt／case temperature | 熱態 calibration | 冷／熱車標籤或時間 proxy |
| Weather／wind | density、aero scenario | 使用標準環境並顯示未修正 |

### 6.8 驗證計畫與完成定義

#### 數學／幾何

- `q=1` 時精確長度式回到 `2C+2πR`；前後包角均為 `π`。
- 用 [S2] 附錄參數交叉核對 belt length、sheave displacement、spring／cam force 與單點平衡質量的量級。
- 珠道為直線時，式 (2-2) 與有限位移機械利益一致；點表平滑後不得產生非物理負斜率。
- 所有角度基準、g/kg、mm/m、rpm/rad·s⁻¹ 有明確轉換測試。

#### 實車／台架

- baseline：冷／熱、升／降檔、至少低中高三負載重複，報 repeatability。
- sensitivity：至少一組未參與 fitting 的珠重與一組彈簧 setup；檢查方向、全行程誤差與 200 rpm/g 經驗點。
- geometry：盤面記號／拆車量得節圓與 Phase 1 solve 對拍。
- slip：至少一個已知不滑與刻意接近滑動的工況；沒有 shaft speed／torque 感測時只驗證警示一致性，不聲稱辨識 `μ`。

#### 產品驗收

- 任一假設值在 UI、匯出報告與圖例都帶「假設／未校正」。
- 缺參數時功能可降級且理由具體，不顯示 NaN、假零或虛構建議。
- 實測曲線、模型曲線與 residual 可同圖比較；使用者可追到每條曲線採用的 setup revision。
- cursor 互動不觸發求根／Monte Carlo；長 log 的 derived series 可取消、可快取、換 profile 後正確失效。

### 6.9 建議的誠實邊界文案

> 此模型以量得的 CVT 幾何與準靜態力平衡估算。未校正時，摩擦、皮帶熱態變形、升降檔遲滯與離合器滑動可能造成顯著差異；結果適合比較改裝方向與規劃試車，不代表零件安全保證或馬力機實測。

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
- **[S16]** Enrico Nino Manes, “Design and Modeling of a Novel Continuously Variable Transmission,” Ph.D. dissertation, Purdue University. <https://docs.lib.purdue.edu/dissertations/AAI3481098/>
- **[S17]** NASA Glenn Research Center, “Equation of State (Ideal Gas).” <https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/equation-of-state-ideal-gas-2/>
- **[S18]** Reza N. Jazar, *Vehicle Dynamics: Theory and Application*, 3rd ed., Springer, 2017. <https://doi.org/10.1007/978-3-319-53441-1>
- **[S19]** Ki-Kap Kim, Yoon-Sik Jun, “A Study of Kinematic Analysis for Improvement of Transmitting Torque of Centrifugal Clutch,” *Journal of the Korean Society of Manufacturing Technology*, 12(4), 173–178, 2010. <https://doi.org/10.17958/ksmt.12.4.201012.173>

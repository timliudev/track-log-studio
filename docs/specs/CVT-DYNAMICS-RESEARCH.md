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

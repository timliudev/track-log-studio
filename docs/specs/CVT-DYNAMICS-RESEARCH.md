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


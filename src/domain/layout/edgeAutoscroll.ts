/**
 * B102a — F1 phase 5 手勢引擎:行動版完整儀表板(單欄 grid,`mobileMode===
 * 'full'`)是整個「頁面」在捲動一個內容高度撐出來的長 grid(見
 * AnalyzerView.vue `.analyzer.focus-mode` 那條規則的註解——只有 Focus Stack
 * 模式才有自己的內部捲動容器,完整模式底下沒有,捲的是 `window`/document 本
 * 身)。拖曳卡片排序時,手指若停在畫面頂/底邊緣附近,應該要能把頁面往那個
 * 方向捲,才搆得到目前畫面外的位置——沒有這個機制,一次拖曳能到達的範圍就
 * 被死死限制在「手指按下那一刻螢幕裝得下的範圍」。
 *
 * 這裡只算「該用多快的速度捲」,刻意不碰任何 DOM/rAF/`scrollBy`——純函式,
 * 邊界值(剛好卡在死區邊緣、指標移到視窗外、極矮視窗兩側死區重疊)才能離線
 * 寫測試釘住。DOM 端(DashboardCard.vue)的活只是每一影格呼叫這個函式取得
 * 目前該用的 px/frame 位移量,套進 `window.scrollBy` ——跟 touchDragDelay.ts
 * 的純狀態機 / DOM 分工是同一個模式。
 */
export interface EdgeAutoscrollConfig {
  /** 指標要多接近視窗上/下邊緣(CSS px)才開始有捲動速度——比 touchDragDelay
   *  的 10px 手震容許值粗了一個量級,是「你正靠近邊緣」這種比較寬鬆的判定,
   *  不是防手震用的窄門檻,免得拖曳一開始隨手划到頂部工具列附近就誤觸。 */
  edgePx: number
  /** 指標壓在邊緣本身(或更外側)時的最高捲動速度,單位 px/影格。以穩定
   *  60fps 估,16px/frame ≈ 960px/s——快到一般手機一秒內就能捲完一整個畫面
   *  高度,但沒快到使用者來不及把手指移回死區煞車、结果overshoot 太多。 */
  maxVelocityPxPerFrame: number
}

/** 64px 死區、16px/frame 頂速——見上面兩個欄位各自的理由。 */
export const DEFAULT_EDGE_AUTOSCROLL_CONFIG: EdgeAutoscrollConfig = {
  edgePx: 64,
  maxVelocityPxPerFrame: 16,
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/**
 * 指標目前在 `pointerY`(CSS px,視窗座標——即一般 `PointerEvent.clientY`),
 * 視窗涵蓋 `[viewportTop, viewportTop + viewportHeight)` 時,這一影格該用的
 * 捲動速度(px/frame;正值 = 往下捲、負值 = 往上捲、0 = 死區,不捲)。
 * `viewportTop` 通常是 0(clientY 座標系本來就是從視窗頂端算起)——仍當參數
 * 收,只是為了讓這個函式離線可測、不用真的碰 `window`。
 *
 * 死區邊緣(距離剛好等於 `edgePx`)線性斜坡到 0,指標壓在實體邊緣(距離 0)
 * 或更外側(距離為負——指標其實已經被拖到視窗外,例如上一影格已經捲動過
 * 導致這一影格量到的座標略為超出)都封頂在 `maxVelocityPxPerFrame`,不會因
 * 為距離變成很大的負值而衝出這個上限。極矮視窗(高度小於 `2*edgePx`,兩側
 * 死區重疊)時以「距離較近的那一側」決定方向,正中央這種罕見的等距情形則固
 * 定選「往下捲」——一個穩定但武斷的選擇,只求兩側結果不會互相打架。
 */
export function edgeAutoscrollVelocity(
  pointerY: number,
  viewportTop: number,
  viewportHeight: number,
  config: EdgeAutoscrollConfig = DEFAULT_EDGE_AUTOSCROLL_CONFIG,
): number {
  if (!(viewportHeight > 0) || !(config.edgePx > 0)) return 0
  const viewportBottom = viewportTop + viewportHeight
  const distFromTop = pointerY - viewportTop
  const distFromBottom = viewportBottom - pointerY
  const nearTop = distFromTop < config.edgePx
  const nearBottom = distFromBottom < config.edgePx
  if (!nearTop && !nearBottom) return 0
  const goUp = nearTop && (!nearBottom || distFromTop < distFromBottom)
  const dist = goUp ? distFromTop : distFromBottom
  const t = clamp01(1 - dist / config.edgePx)
  return (goUp ? -1 : 1) * t * config.maxVelocityPxPerFrame
}

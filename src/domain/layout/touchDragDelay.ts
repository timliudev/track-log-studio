/**
 * B61 — 手機模式下,手指按在卡片標題(拖曳把手)上會立刻進入拖曳排序,跟使用者
 * 想捲動頁面的手勢打架(同一個「往下滑」到底是要拖卡片還是捲頁面,沒有任何
 * 猶豫空間)。滑鼠/觸控筆(pen)不受影響——桌機使用者按下就拖是正常手感,
 * 也沒有「跟捲動打架」這回事(§8 layer 2:行為分支看
 * `PointerEvent.pointerType`,不是看裝置/斷點)。
 *
 * 這個模組只管「按住多久算長按、位移多少算取消」的純判斷,不碰 DOM/計時器
 * ——實際的 pointerdown/move/up 監聽、setTimeout、和「長按判定成立後怎麼把
 * 這個手勢轉發給 grid-layout-plus 自己的 interactjs」都在 DashboardCard.vue
 * (真實瀏覽器行為,無法在這裡離線測試,見該檔案的實作註記)。
 *
 * 狀態機三態:
 *  - 'pending'  剛按下,計時器還沒到,位移也還沒超過閾值。
 *  - 'armed'    計時器到期,期間位移全程在閾值內——可以開始拖曳了。
 *  - 'cancelled' 位移超過閾值(判定成想捲動)——終態,不會因為之後計時器到期
 *               而復活成 armed;也不會因為後續位移縮回閾值內而復活成 pending。
 */

export interface TouchDragDelayConfig {
  /** 需要按住多久(毫秒)才算長按成立。DESIGN.md §8 訂在 250~350ms 之間——
   *  短到不會讓使用者覺得卡頓,長到明顯跟「隨手一滑要捲動」的手勢區分開。 */
  delayMs: number
  /** 按住期間位移超過這個像素數,視為捲動意圖,直接判定取消。 */
  moveThresholdPx: number
}

/** 300ms 落在 DESIGN.md §8 規定的 250~350ms 區間中點;10px 是一般觸控 UI
 *  常見的「這是誤觸/手抖,還是真的想滑動」門檻(同一量級可參考
 *  edgeGesture.ts 的 8px insetPx)。 */
export const DEFAULT_TOUCH_DRAG_DELAY: TouchDragDelayConfig = {
  delayMs: 300,
  moveThresholdPx: 10,
}

export type TouchDragDelayState = 'pending' | 'armed' | 'cancelled'

/** 按住期間手指移動的直線距離是否超過取消閾值——純函式,方便對邊界值
 *  (剛好等於閾值、對角線位移等)寫測試。 */
export function exceedsMoveThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  config: TouchDragDelayConfig = DEFAULT_TOUCH_DRAG_DELAY,
): boolean {
  const dx = currentX - startX
  const dy = currentY - startY
  return Math.hypot(dx, dy) > config.moveThresholdPx
}

/**
 * 一次 pointermove 位移後的狀態轉移。只有 'pending' 會被移動事件影響——
 * 'armed'(已經轉發給 grid-layout-plus,後續位移歸它自己的拖曳邏輯管)跟
 * 'cancelled'(終態)都原樣傳回。
 */
export function advanceOnMove(
  state: TouchDragDelayState,
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  config: TouchDragDelayConfig = DEFAULT_TOUCH_DRAG_DELAY,
): TouchDragDelayState {
  if (state !== 'pending') return state
  return exceedsMoveThreshold(startX, startY, currentX, currentY, config) ? 'cancelled' : 'pending'
}

/**
 * 長按計時器到期時的狀態轉移。只有還在 'pending' 才會變成 'armed'——如果位移
 * 早就把狀態轉成 'cancelled',計時器到期也不該讓它死灰復燃再開始拖曳。
 */
export function advanceOnTimeout(state: TouchDragDelayState): TouchDragDelayState {
  return state === 'pending' ? 'armed' : state
}

/**
 * B102b — F1 phase 5 手勢引擎的第三個轉移入口(前兩個是 advanceOnMove/
 * advanceOnTimeout)。第二根手指在這根手指還 'pending' 的長按判定期間按下,
 * 代表使用者正在用另一根手指做別的事(最常見:單手長按住卡片標題的同時,
 * 另一手在捲頁面)——這已經不是單指長按拖曳手勢了,直接判定取消,交還原生
 * (跟位移超閾值同一個終態 'cancelled',不會因為計時器之後到期而復活)。
 *
 * 只有 'pending' 會被這個事件影響: 'armed' 這個模組自己的職責已經在
 * onTouchDragTimeout 交棒給 grid-layout-plus 之後就結束了(DashboardCard.vue
 * 會把 touchDragState 直接歸零,不會再看到這個狀態)——之後同一個拖曳手勢中
 * 出現第二指,是 DOM 層(見 DashboardCard.vue 的 dragPointerId 追蹤 + 合成
 * pointercancel 中止 interactjs)另外處理的問題,不是這個純狀態機的職責範圍;
 * 'cancelled' 一樣是終態,原樣傳回。
 */
export function advanceOnSecondPointer(state: TouchDragDelayState): TouchDragDelayState {
  return state === 'pending' ? 'cancelled' : state
}

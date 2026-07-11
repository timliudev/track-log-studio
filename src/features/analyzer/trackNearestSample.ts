/**
 * 賽道地圖 ↔ 圖表游標連動：滑鼠在地圖上移動時，找出離指標最近的軌跡樣本
 * index，寫回共用的 session-index 游標狀態（analyzerStore.cursorIdx）。
 *
 * Extracted out of TrackMap.vue's onPointerMove (idle-hover branch) as a pure
 * function so the "map pixel → nearest sample index" hit-test is unit
 * testable without mounting the canvas/Vue component. Behaviour is
 * unchanged: same squared-distance nearest-neighbour scan, same hit-radius
 * gate (returns null when nothing is within `hitRadius` px of the pointer,
 * so empty space around the track doesn't snap to the outermost point).
 */
export function nearestSample(
  px: ArrayLike<number>,
  py: ArrayLike<number>,
  x: number,
  y: number,
  hitRadius: number,
): number | null {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < px.length; i++) {
    if (Number.isNaN(px[i])) continue
    const dx = px[i] - x
    const dy = py[i] - y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  const hit = hitRadius * hitRadius
  return best >= 0 && bestD <= hit ? best : null
}

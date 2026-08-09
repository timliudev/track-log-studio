import { describe, it, expect } from 'vitest'
import {
  springStep,
  isSpringSettled,
  SPRING_DRAG_RELEASE,
  SPRING_DEFAULT,
  SPRING_MAX_DT_SEC,
  type SpringState,
  type SpringParams,
} from '@/domain/interaction/spring'

/** Runs `steps` frames of `dtSec` each and returns the final state — used
 *  throughout to simulate "let the spring run for N seconds" without every
 *  test hand-rolling its own loop. */
function simulate(state: SpringState, target: number, params: SpringParams, dtSec: number, steps: number): SpringState {
  let s = state
  for (let i = 0; i < steps; i++) s = springStep(s, target, params, dtSec)
  return s
}

describe('springStep', () => {
  it('is a no-op for a non-positive dtSec', () => {
    const state: SpringState = { position: 10, velocity: 5 }
    expect(springStep(state, 0, SPRING_DEFAULT, 0)).toEqual(state)
    expect(springStep(state, 0, SPRING_DEFAULT, -0.01)).toEqual(state)
  })

  it('stays at rest when already at the target with zero velocity (equilibrium)', () => {
    const state: SpringState = { position: 0, velocity: 0 }
    const next = springStep(state, 0, SPRING_DRAG_RELEASE, 1 / 60)
    expect(next.position).toBeCloseTo(0, 10)
    expect(next.velocity).toBeCloseTo(0, 10)
  })

  it('critically damped (dampingRatio=1) approaches the target monotonically, never overshooting', () => {
    const params: SpringParams = { dampingRatio: 1, responseSec: 0.3 }
    let s: SpringState = { position: 100, velocity: 0 }
    let prevAbs = Math.abs(s.position)
    for (let i = 0; i < 200; i++) {
      s = springStep(s, 0, params, 1 / 60)
      const abs = Math.abs(s.position)
      // Monotonically shrinking distance to target — no overshoot means the
      // position never crosses 0 (sign never flips) and never moves farther
      // from the target than the previous frame.
      expect(abs).toBeLessThanOrEqual(prevAbs + 1e-9)
      prevAbs = abs
    }
    expect(s.position).toBeCloseTo(0, 1)
  })

  it('underdamped (dampingRatio<1, e.g. the drag-release preset) overshoots the target at least once', () => {
    let s: SpringState = { position: 100, velocity: 0 }
    let crossedZero = false
    for (let i = 0; i < 200; i++) {
      const prevSign = Math.sign(s.position)
      s = springStep(s, 0, SPRING_DRAG_RELEASE, 1 / 60)
      if (prevSign > 0 && s.position < 0) crossedZero = true
    }
    expect(crossedZero).toBe(true)
    // ...but still converges back to the target eventually.
    expect(isSpringSettled(s, 0)).toBe(true)
  })

  it('converges to the target from a nonzero initial velocity (release-velocity seeded settle)', () => {
    const s = simulate({ position: 40, velocity: -800 }, 0, SPRING_DRAG_RELEASE, 1 / 60, 300)
    expect(isSpringSettled(s, 0)).toBe(true)
  })

  it('settles toward a nonzero target, not just toward 0', () => {
    const s = simulate({ position: 0, velocity: 0 }, 250, SPRING_DEFAULT, 1 / 60, 300)
    expect(s.position).toBeCloseTo(250, 0)
  })

  it('is deterministic: same inputs produce the same outputs', () => {
    const a = springStep({ position: 12, velocity: -34 }, 5, SPRING_DRAG_RELEASE, 1 / 60)
    const b = springStep({ position: 12, velocity: -34 }, 5, SPRING_DRAG_RELEASE, 1 / 60)
    expect(a).toEqual(b)
  })
})

describe('isSpringSettled', () => {
  it('is true at exact equilibrium', () => {
    expect(isSpringSettled({ position: 0, velocity: 0 }, 0)).toBe(true)
  })

  it('is false while still far from the target even with zero velocity', () => {
    expect(isSpringSettled({ position: 100, velocity: 0 }, 0)).toBe(false)
  })

  it('is false while close to the target but still moving fast', () => {
    expect(isSpringSettled({ position: 0.01, velocity: 500 }, 0)).toBe(false)
  })

  it('respects custom epsilon overrides', () => {
    expect(isSpringSettled({ position: 5, velocity: 0 }, 0, 10, 4)).toBe(true)
    expect(isSpringSettled({ position: 5, velocity: 0 }, 0, 1, 4)).toBe(false)
  })
})

describe('SPRING_MAX_DT_SEC', () => {
  it('is a small positive fraction of a second', () => {
    expect(SPRING_MAX_DT_SEC).toBeGreaterThan(0)
    expect(SPRING_MAX_DT_SEC).toBeLessThan(0.1)
  })
})

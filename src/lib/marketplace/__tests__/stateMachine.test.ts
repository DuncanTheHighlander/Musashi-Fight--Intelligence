import { describe, expect, test } from 'vitest'
import { assertTransition } from '../stateMachine'

describe('marketplace stateMachine', () => {
  test('DISMISS_DISPUTE returns job to SUBMITTED', () => {
    expect(assertTransition('DISPUTED', 'DISMISS_DISPUTE')).toBe('SUBMITTED')
  })
})

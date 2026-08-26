import { describe, expect, it } from 'vitest'
import {
  calculatePreparedImageQueueBudget,
  calculatePreparedImageQueueCapacity,
} from '../../backend/desktopBridge/services/fileImageQueueBudget'

const GIB = 1024 ** 3

describe('prepared image queue budget', () => {
  it('leaves one GiB available on a four GiB system', () => {
    expect(calculatePreparedImageQueueBudget(4 * GIB, 4 * GIB)).toBe(3 * GIB)
  })

  it('caps the queue budget at five GiB on larger systems', () => {
    expect(calculatePreparedImageQueueBudget(16 * GIB, 16 * GIB)).toBe(5 * GIB)
    expect(calculatePreparedImageQueueBudget(64 * GIB, 48 * GIB)).toBe(5 * GIB)
  })

  it('preserves the scaled reserve when available memory is limited', () => {
    expect(calculatePreparedImageQueueBudget(16 * GIB, 4 * GIB)).toBe(1 * GIB)
  })

  it('keeps enough pending work to occupy the image workers on a constrained system', () => {
    expect(calculatePreparedImageQueueCapacity(4 * GIB, 512 * 1024 ** 2, 24, 256)).toBe(24)
  })

  it('bounds a large-memory machine to four prepared inference batches', () => {
    expect(calculatePreparedImageQueueCapacity(64 * GIB, 48 * GIB, 24, 256)).toBe(1024)
  })
})

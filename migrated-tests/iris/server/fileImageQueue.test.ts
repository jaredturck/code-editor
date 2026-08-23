import { describe, expect, it } from 'vitest'
import { FileImageQueue } from '../../server/desktopBridge/services/fileImageQueue'

describe('file image queue', () => {
  it('preserves FIFO order while releasing consumed entries across sustained reuse', () => {
    const queue = new FileImageQueue<number>()
    for (let index = 0; index < 5000; index += 1) {
      queue.push(index)
      expect(queue.shift()).toBe(index)
    }
    expect(queue.length).toBe(0)
  })

  it('drains each pending entry exactly once', () => {
    const queue = new FileImageQueue<string>()
    queue.push('first')
    queue.push('second')
    const values: string[] = []
    queue.drain((value) => values.push(value))
    expect(values).toEqual(['first', 'second'])
    expect(queue.length).toBe(0)
  })
})

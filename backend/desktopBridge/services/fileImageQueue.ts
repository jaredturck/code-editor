/**
 * Provides an allocation-conscious FIFO queue for the image pipeline. Consumed entries are
 * released immediately, while occasional bounded compaction avoids Array.shift() on hot paths.
 */
export class FileImageQueue<T> {
  private items: Array<T | undefined> = [];
  private head = 0;

  /** Returns the number of live entries currently available to consume. */
  get length(): number {
    return this.items.length - this.head;
  }

  /** Appends one entry without moving existing queued values. */
  push(item: T): void {
    this.items.push(item);
  }

  /** Removes and releases the oldest entry without shifting the backing array. */
  shift(): T | undefined {
    if (!this.length) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head += 1;
    if (this.head === this.items.length) {
      this.items.length = 0;
      this.head = 0;
    } else if (this.head >= 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }

  /** Removes every live entry and invokes the supplied cleanup callback in FIFO order. */
  drain(consume: (item: T) => void): void {
    let item = this.shift();
    while (item !== undefined) {
      consume(item);
      item = this.shift();
    }
  }
}

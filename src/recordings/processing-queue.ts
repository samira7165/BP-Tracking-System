/** Runs jobs strictly one at a time, first come first served. */
export class ProcessingQueue {
  private readonly waiting: string[] = [];
  private current: string | null = null;
  /** Seconds the latest successful jobs took, for estimating the wait. */
  private readonly durations: number[] = [];

  /** `run` must not throw; it returns true when the job succeeded. */
  constructor(private readonly run: (id: string) => Promise<boolean>) {}

  has(id: string): boolean {
    return this.current === id || this.waiting.includes(id);
  }

  /** Everything waiting or running. */
  ids(): string[] {
    return this.current ? [this.current, ...this.waiting] : [...this.waiting];
  }

  add(id: string) {
    if (this.has(id)) return;
    this.waiting.push(id);
    void this.drain();
  }

  /** Takes a job out of the line. One that is already running is left to finish. */
  remove(id: string) {
    const i = this.waiting.indexOf(id);
    if (i >= 0) this.waiting.splice(i, 1);
  }

  /** null when the job is not waiting. */
  position(id: string): { ahead: number; waitSec: number | null } | null {
    const i = this.waiting.indexOf(id);
    if (i < 0) return null;
    const ahead = i + (this.current ? 1 : 0);
    if (!this.durations.length) return { ahead, waitSec: null };
    const average = this.durations.reduce((a, b) => a + b, 0) / this.durations.length;
    return { ahead, waitSec: Math.round(ahead * average) };
  }

  private async drain() {
    if (this.current) return;
    let next: string | undefined;
    while ((next = this.waiting.shift())) {
      this.current = next;
      const started = Date.now();
      try {
        if (await this.run(next)) {
          this.durations.push((Date.now() - started) / 1000);
          if (this.durations.length > 10) this.durations.shift();
        }
      } catch {
        // One bad job must never stop the line
      } finally {
        this.current = null;
      }
    }
  }
}

'use strict';

/**
 * Minimal in-process concurrency gate (counting semaphore). No dependencies.
 *
 * Caps how many operations run at once; the rest queue FIFO and start as
 * permits free up. Use it as:
 *
 *     await gate.acquire();
 *     try { ...work... } finally { gate.release(); }
 *
 * or via the helper:  await runExclusive(gate, async () => { ...work... });
 *
 * Notes:
 *  - Per-instance, like the credits cache — it bounds ONE Node process. That's
 *    the right scope here: it exists to stop a single instance fanning out into
 *    hundreds of concurrent upstream calls / base64 images under a traffic spike.
 *  - `acquire()` never rejects; it only ever resolves (immediately if a permit
 *    is free, otherwise when one frees up). That's what makes the acquire/
 *    try-finally pattern leak-proof: the release is always reached.
 */
class ConcurrencyGate {
  constructor(limit) {
    const n = parseInt(limit, 10);
    this.limit = Number.isFinite(n) && n > 0 ? n : 1;
    this.active = 0;      // permits currently held (operations running)
    this.queue = [];      // FIFO of resolvers waiting for a permit
  }

  acquire() {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    const next = this.queue.shift();
    if (next) {
      // Hand this permit straight to the next waiter: one op finished, one
      // starts, so `active` stays the same (never dips then spikes).
      next();
    } else {
      // No one waiting — free the permit.
      this.active = Math.max(0, this.active - 1);
    }
  }

  stats() {
    return { active: this.active, queued: this.queue.length, limit: this.limit };
  }
}

/** Run `fn` under the gate, guaranteeing the permit is released even if it throws. */
async function runExclusive(gate, fn) {
  await gate.acquire();
  try {
    return await fn();
  } finally {
    gate.release();
  }
}

module.exports = { ConcurrencyGate, runExclusive };

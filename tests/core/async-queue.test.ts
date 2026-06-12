import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../../src/core/async-queue.js";

describe("AsyncQueue", () => {
  it("delivers pushed items to an async iterator, including items pushed before iteration", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const n of q) seen.push(n);
    })();
    q.push(2);
    q.end();
    await consumer;
    expect(seen).toEqual([1, 2]);
  });

  it("resolves waiting consumers when an item arrives later", async () => {
    const q = new AsyncQueue<string>();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push("hello");
    expect((await pending).value).toBe("hello");
    q.end();
    expect((await it.next()).done).toBe(true);
  });
});

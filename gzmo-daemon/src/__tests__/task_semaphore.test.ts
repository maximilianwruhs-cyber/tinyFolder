import { describe, expect, test } from "bun:test";
import { TaskSemaphore, readTaskConcurrency } from "../task_semaphore";

describe("TaskSemaphore", () => {
  test("rejects invalid limit", () => {
    expect(() => new TaskSemaphore(0)).toThrow();
    expect(() => new TaskSemaphore(-1)).toThrow();
    expect(() => new TaskSemaphore(NaN)).toThrow();
  });

  test("limit=1 serialises two concurrent calls", async () => {
    const sem = new TaskSemaphore(1);
    const order: string[] = [];
    const a = sem.run(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-end");
    });
    const b = sem.run(async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([a, b]);
    // b cannot have started before a finished.
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  test("limit=2 allows up to 2 concurrent runs", async () => {
    const sem = new TaskSemaphore(2);
    let peak = 0;
    let active = 0;
    const job = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
    };
    await Promise.all([sem.run(job), sem.run(job), sem.run(job), sem.run(job)]);
    expect(peak).toBe(2);
  });

  test("release after exception still hands off the permit", async () => {
    const sem = new TaskSemaphore(1);
    let secondRan = false;
    const a = sem.run(async () => {
      throw new Error("boom");
    }).catch(() => "swallowed");
    const b = sem.run(async () => {
      secondRan = true;
    });
    await Promise.all([a, b]);
    expect(secondRan).toBe(true);
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);
  });
});

describe("readTaskConcurrency", () => {
  const original = process.env.GZMO_TASK_CONCURRENCY;
  function reset() {
    if (original === undefined) delete process.env.GZMO_TASK_CONCURRENCY;
    else process.env.GZMO_TASK_CONCURRENCY = original;
  }

  test("defaults to 1 when unset", () => {
    delete process.env.GZMO_TASK_CONCURRENCY;
    expect(readTaskConcurrency()).toBe(1);
    reset();
  });

  test("parses positive integer", () => {
    process.env.GZMO_TASK_CONCURRENCY = "4";
    expect(readTaskConcurrency()).toBe(4);
    reset();
  });

  test("clamps to >=1 for nonsense values", () => {
    process.env.GZMO_TASK_CONCURRENCY = "garbage";
    expect(readTaskConcurrency()).toBe(1);
    process.env.GZMO_TASK_CONCURRENCY = "0";
    expect(readTaskConcurrency()).toBe(1);
    process.env.GZMO_TASK_CONCURRENCY = "-3";
    expect(readTaskConcurrency()).toBe(1);
    reset();
  });

  test("caps to 8", () => {
    process.env.GZMO_TASK_CONCURRENCY = "999";
    expect(readTaskConcurrency()).toBe(8);
    reset();
  });
});

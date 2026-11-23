import { describe, expect, it } from "vitest";
import { withDeadline } from "../src/request-timeout";

describe("abortable request deadlines", () => {
  it("returns the result when work finishes before the deadline", async () => {
    await expect(withDeadline(async () => "ok", 1000)).resolves.toBe("ok");
  });

  it("aborts the underlying work and reports a friendly timeout", async () => {
    let aborted = false;
    await expect(withDeadline((signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    }), 20)).rejects.toThrow("timed out");
    expect(aborted).toBe(true);
  });

  it("forwards a caller-supplied abort signal", async () => {
    const caller = new AbortController();
    const pending = withDeadline((signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("caller aborted")));
    }), 5000, caller.signal);
    caller.abort();
    await expect(pending).rejects.toThrow("caller aborted");
  });

  it("preserves the original error when work fails before the deadline", async () => {
    await expect(withDeadline(async () => {
      throw new Error("boom");
    }, 5000)).rejects.toThrow("boom");
  });
});

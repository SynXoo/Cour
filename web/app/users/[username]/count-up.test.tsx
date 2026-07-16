import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountUp } from "./count-up";

const integer = (n: number) => String(Math.round(n));

/** Captures the observed element and lets a test decide when it scrolls in. */
let intersect: (() => void) | null = null;
let disconnected = false;

class IntersectionObserverStub {
  constructor(private cb: IntersectionObserverCallback) {}
  observe() {
    intersect = () =>
      this.cb(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  disconnect() {
    disconnected = true;
  }
  unobserve() {}
}

function setMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
}

beforeEach(() => {
  intersect = null;
  disconnected = false;
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CountUp", () => {
  it("renders the true value first, so SSR and no-JS readers see the number", () => {
    setMotion(true);
    const { container } = render(<CountUp value={599} format={integer} />);
    expect(container.textContent).toBe("599");
  });

  it("leaves the number alone under reduced motion — no observer, no zeroing", () => {
    setMotion(true);
    render(<CountUp value={599} format={integer} />);
    expect(screen.getByText("599")).toBeInTheDocument();
    expect(intersect).toBeNull();
  });

  it("zeroes before paint, then counts to the true value once scrolled into view", async () => {
    setMotion(false);
    const { container } = render(<CountUp value={100} format={integer} />);

    // The layout effect has already run: nothing was ever painted at 100.
    expect(container.textContent).toBe("0");

    intersect!();
    expect(disconnected).toBe(true); // fires once, never again

    await vi.advanceTimersByTimeAsync(1200); // past DURATION_MS
    expect(container.textContent).toBe("100");
  });

  it("is monotonic on the way up and never overshoots", async () => {
    setMotion(false);
    const { container } = render(<CountUp value={100} format={integer} />);
    intersect!();

    let previous = 0;
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(100);
      const shown = Number(container.textContent);
      expect(shown).toBeGreaterThanOrEqual(previous);
      expect(shown).toBeLessThanOrEqual(100);
      previous = shown;
    }
    expect(previous).toBe(100);
  });

  it("retargets rather than restarting when the value changes mid-flight", async () => {
    setMotion(false);
    const { container, rerender } = render(<CountUp value={100} format={integer} />);
    intersect!();
    await vi.advanceTimersByTimeAsync(200);
    expect(Number(container.textContent)).toBeGreaterThan(0);

    rerender(<CountUp value={42} format={integer} />);
    await vi.advanceTimersByTimeAsync(1200);
    expect(container.textContent).toBe("42");
  });

  it("survives a parent re-render that does not move the value", async () => {
    setMotion(false);
    const { container, rerender } = render(<CountUp value={100} format={integer} />);
    intersect!();
    await vi.advanceTimersByTimeAsync(1200);
    expect(container.textContent).toBe("100");

    // An inline formatter is a fresh identity every render; it must not
    // re-zero a landed number.
    rerender(<CountUp value={100} format={(n) => String(Math.round(n))} />);
    expect(container.textContent).toBe("100");
  });
});

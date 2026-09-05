import "@testing-library/jest-dom/vitest";

// jsdom ships neither of these, and cmdk (the command palette behind the
// episode jump box) mounts a ResizeObserver on every list it renders.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

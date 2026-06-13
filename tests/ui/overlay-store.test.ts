import { describe, it, expect } from "vitest";
import { createAppStore } from "../../src/store.js";

describe("store: overlay", () => {
  it("defaults to null and setOverlay toggles between help/sessions/null", () => {
    const store = createAppStore("sidebar");
    expect(store.getState().overlay).toBe(null);

    store.getState().setOverlay("help");
    expect(store.getState().overlay).toBe("help");

    store.getState().setOverlay("sessions");
    expect(store.getState().overlay).toBe("sessions");

    store.getState().setOverlay(null);
    expect(store.getState().overlay).toBe(null);
  });

  it("does not disturb paletteOpen", () => {
    const store = createAppStore("sidebar");
    store.getState().setPaletteOpen(true);
    store.getState().setOverlay("help");
    expect(store.getState().paletteOpen).toBe(true);
    expect(store.getState().overlay).toBe("help");
  });
});

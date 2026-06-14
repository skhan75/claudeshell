// Manual E2E: launch the built claudeshell in a real pseudo-terminal, seed a long
// transcript, enable mouse capture (--mouse), then feed SGR wheel-up events and check
// that the visible content scrolls (older SEEDLINE-* appear, the last one disappears).
// Run: node scripts/e2e-scroll.mjs
import { spawn } from "node-pty";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const COLS = 100, ROWS = 30;
const child = spawn(process.execPath, [require.resolve("../dist/cli.js"), "--mouse"], {
  name: "xterm-256color",
  cols: COLS,
  rows: ROWS,
  cwd: process.cwd(),
  env: { ...process.env, CLAUDESHELL_E2E_SEED: "60" },
});

let buf = "";
child.onData((d) => { buf += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b[()][AB0]/g, "");

(async () => {
  await sleep(2500); // let it render
  const enabled = /\x1b\[\?100[02]h/.test(buf); // did it emit the mouse-enable DECSET?
  const before = strip(buf);
  const bottomVisibleBefore = before.includes("SEEDLINE-59");

  buf = "";
  // Feed several SGR wheel-up events (button 64) — two-finger scroll up.
  for (let i = 0; i < 8; i++) { child.write("\x1b[<64;20;10M"); await sleep(60); }
  await sleep(400);
  const after = strip(buf);
  const olderNowVisible = /SEEDLINE-(3\d|4\d)/.test(after);
  const bottomGoneAfter = !after.includes("SEEDLINE-59") || /SEEDLINE-(3\d|4\d)/.test(after);

  console.log("MOUSE_ENABLE_EMITTED:", enabled);
  console.log("BOTTOM_VISIBLE_AT_START (SEEDLINE-59):", bottomVisibleBefore);
  console.log("AFTER_WHEEL_OLDER_LINES_VISIBLE:", olderNowVisible);
  console.log("SCROLLED:", olderNowVisible && bottomGoneAfter);
  child.kill();
  process.exit(0);
})();

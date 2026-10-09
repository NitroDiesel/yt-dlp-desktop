// Captures the README screenshots in docs/media from the dev visual preview.
// Usage: start `pnpm dev`, then `CHROME=<path to Chrome or chrome-headless-shell> node scripts/capture-readme-screenshots.mjs`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const chrome = process.env.CHROME;
if (!chrome) throw new Error("Set CHROME to a Chrome or chrome-headless-shell executable");
const out = path.resolve("docs/media");
const port = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "readme-shots-"));
const browser = spawn(chrome, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--hide-scrollbars",
  "--font-render-hinting=none",
  "about:blank",
], { stdio: "ignore" });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let targets;
for (let attempt = 0; attempt < 50 && !targets; attempt++) {
  await wait(200);
  targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => undefined);
}
const page = targets.find((target) => target.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => {
  const reply = await send("Page.captureScreenshot", { format: "webp", quality: 90 });
  fs.writeFileSync(path.join(out, `${name}.webp`), Buffer.from(reply.result.data, "base64"));
  console.log("saved", name);
};

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
for (const theme of ["dark", "light"]) {
  await send("Page.navigate", { url: `http://localhost:1420/?visual-preview&showcase&theme=${theme}` });
  console.log(theme, await evaluate(`(async () => {
    for (let i = 0; i < 100 && document.querySelectorAll(".job-row").length < 9; i++) await new Promise((r) => setTimeout(r, 100));
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 400));
    return document.documentElement.dataset.theme + " rows=" + document.querySelectorAll(".job-row").length;
  })()`));
  await shot(`downloads-${theme}`);
  console.log(await evaluate(`(async () => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://www.youtube.com/watch?v=preview");
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && !document.querySelector("dialog[open] #video-codec"); i++) await new Promise((r) => setTimeout(r, 100));
    document.activeElement?.blur();
    await new Promise((r) => setTimeout(r, 500));
    return "dialog " + !!document.querySelector("dialog[open]");
  })()`));
  await shot(`new-download-${theme}`);
}
ws.close();
const exited = new Promise((resolve) => browser.once("exit", resolve));
browser.kill();
await exited;
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
console.log("done");

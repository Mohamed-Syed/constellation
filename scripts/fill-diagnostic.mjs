// Full-exception diagnostic: login -> /engine -> run the exact fill expression.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9224;

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "cst-dbg-"));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await send("Page.enable"); await send("Runtime.enable");

  // login
  await send("Page.navigate", { url: "http://localhost:3005/login" });
  await sleep(4000);
  await evalJs(`(() => { const el = document.querySelector('#email'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, 'admin@constellation.local'); el.dispatchEvent(new Event('input', {bubbles:true})); return 'ok'; })()`);
  await evalJs(`(() => { const el = document.querySelector('#password'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, 'changeme'); el.dispatchEvent(new Event('input', {bubbles:true})); return 'ok'; })()`);
  await evalJs(`document.querySelector('button[type=submit]').click()`);
  await sleep(6000);
  console.log("after login path:", (await evalJs("location.pathname")).result?.value);

  await send("Page.navigate", { url: "http://localhost:3005/engine" });
  await sleep(6000);
  console.log("engine path:", (await evalJs("location.pathname")).result?.value);
  console.log("inputs:", JSON.stringify((await evalJs("Array.from(document.querySelectorAll('input,textarea')).map(e => e.id)")).result?.value));

  const value = "Use the graph.query tool from the graphify plugin with question set to: what does the plugin loader do? Use limit 100. Then after the tool result, finish with a done action summarizing the answer.";
  const expr = `(() => { const el = document.querySelector("#engine-task-prompt"); if (!el) return 'NO-EL: ' + "#engine-task-prompt";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return 'filled ' + "#engine-task-prompt"; })()`;
  console.log("EXPR:\n" + expr + "\n---");
  const r = await evalJs(expr);
  console.log("RESULT:", JSON.stringify(r).slice(0, 1500));
  try { ws.close(); } catch {} chrome.kill(); process.exit(0);
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });

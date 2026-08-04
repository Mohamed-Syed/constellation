// Zero-dependency Chrome DevTools Protocol driver (Node 22: native fetch + WebSocket).
// Usage: node scripts/cdp-browser.mjs <flow-json> — see the Task-4 flow for an example.
// Spawns a dedicated headless Chrome, drives it via CDP, saves screenshots.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9223;
const OUT_DIR = process.argv[3] ?? "artifacts/engine-portal";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const flow = JSON.parse(readFileSync(process.argv[2], "utf8"));
  mkdirSync(OUT_DIR, { recursive: true });

  // Launch a dedicated Chrome instance with a throwaway profile.
  const profile = join(process.env.TEMP ?? "/tmp", `cst-cdp-${Date.now()}`);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,900",
    "about:blank",
  ], { stdio: "ignore" });

  // Wait for the devtools endpoint.
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets.length) break;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!targets?.length) throw new Error("Chrome CDP did not come up");

  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const consoleLogs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === "Runtime.consoleAPICalled") {
      consoleLogs.push(msg.params.type + ": " + (msg.params.args || []).map(a => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Log.entryAdded") consoleLogs.push("LOG " + msg.params.entry.level + ": " + msg.params.entry.text);
    if (msg.method === "Runtime.exceptionThrown") consoleLogs.push("EXC: " + JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
      consoleLogs.push("HTTP " + msg.params.response.status + " " + msg.params.response.url);
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

  /** Set extra HTTP headers for every subsequent request (e.g. Basic auth). */
  const setHeaders = async (headers) => {
    await send("Network.enable", {});
    await send("Network.setExtraHTTPHeaders", { headers });
    return `headers set: ${Object.keys(headers).join(", ")}`;
  };

  const result = { shots: [] };
  const step = async (name, fn) => {
    const v = await fn();
    result.shots.push(name);
    console.log(`STEP ${name}: ${v ?? "ok"}`);
    return v;
  };

  const navigate = async (url) => { await send("Page.navigate", { url }); await waitReady(); };
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      const st = await evalJs("document.readyState");
      if (st === "complete") return;
      await sleep(250);
    }
  };
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
    return r.result?.result?.value;
  };
  const text = () => evalJs("document.body ? document.body.innerText : ''");
  const click = async (selector) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'NO-EL: ' + ${JSON.stringify(selector)}; el.scrollIntoView({block:'center'}); el.click(); return 'clicked ' + ${JSON.stringify(selector)}; })()`);
  const fill = async (selector, value) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'NO-EL: ' + ${JSON.stringify(selector)};
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return 'filled ' + ${JSON.stringify(selector)}; })()`);
  // CDP-native typing: focus the element, then Input.insertText (IME-style).
  // React controlled inputs pick this up reliably (the JS setter trick is
  // flaky against React 19's value tracker).
  const typeInto = async (selector, value) => {
    const f = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'NO-EL'; el.focus(); return 'ok'; })()`);
    if (f !== "ok") return f;
    await send("Input.insertText", { text: value });
    return `typed into ${selector}`;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    console.log(`  📸 ${file}`);
    return file;
  };
  const waitFor = async (expr, timeoutMs = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await evalJs(expr)) return true;
      await sleep(400);
    }
    throw new Error(`waitFor timeout: ${expr}`);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");

  for (const s of flow) {
    const { act, url, selector, text: textVal, expr, shot: shotName, wait } = s;
    const t = s.t ?? textVal; // accept both "t" and "text" as the value key
    if (act === "goto") await step(`goto ${url}`, () => navigate(url));
    if (act === "headers") await step(`headers ${Object.keys(s.headers ?? {}).join(",")}`, () => setHeaders(s.headers));
    if (act === "click") await step(`click ${selector}`, () => click(selector));
    if (act === "fill") await step(`fill ${selector}`, () => fill(selector, t));
    if (act === "type") await step(`type ${selector}`, () => typeInto(selector, t));
    if (act === "eval") await step(`eval ${expr?.slice(0, 60)}`, () => evalJs(expr));
    if (act === "wait") await step(`wait ${expr?.slice(0, 60)}`, () => waitFor(expr, wait ?? 30000));
    if (act === "sleep") await step(`sleep ${s.ms}ms`, () => sleep(s.ms));
    if (act === "text") await step("text", () => text());
    if (act === "shot") await step(`shot ${shotName}`, () => shot(shotName));
  }

  console.log("FLOW_DONE");
  if (consoleLogs.length) {
    console.log("--- CONSOLE ---");
    consoleLogs.slice(-25).forEach((l) => console.log(l.slice(0, 300)));
  }
  try { ws.close(); } catch {}
  chrome.kill();
  process.exit(0);
}

main().catch((e) => { console.error("FLOW_ERROR:", e.message); process.exit(1); });

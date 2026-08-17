import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

/**
 * Zero-dependency SMTP client for the notification SMTP channel (Phase 3.0 —
 * 3.5 remainder). Speaks just enough of the protocol for a mail relay:
 *
 *   connect → wait 220 → EHLO → (AUTH PLAIN when credentials are given) →
 *   MAIL FROM → RCPT TO → DATA → <body>\r\n.\r\n → QUIT
 *
 * Node's built-in `net`/`tls` only. Multi-line responses (EHLO) are folded;
 * any non-2xx reply fails honestly with the server's message. A timeout
 * destroys the socket and reports an error — a stuck relay can never hang a
 * notification dispatch.
 */

export interface SmtpOptions {
  host: string;
  port: number;
  /** Credentials (both or neither — AUTH PLAIN only when both are set). */
  user?: string;
  pass?: string;
  /** Implicit TLS (SMTPS on 465). When false, plain TCP. */
  secure?: boolean;
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  timeoutMs?: number;
}

export interface SmtpResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function sendSmtpMessage(opts: SmtpOptions): Promise<SmtpResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];

  return new Promise<SmtpResult>((resolve) => {
    let settled = false;
    const finish = (result: SmtpResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = opts.secure
      ? tlsConnect({ host: opts.host, port: opts.port, servername: opts.host })
      : netConnect({ host: opts.host, port: opts.port });
    const timer = setTimeout(() => {
      socket.destroy();
      finish({ ok: false, error: `SMTP timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    let buffer = "";
    const pending: Array<(line: string) => void> = [];
    const nextReply = (): Promise<string> =>
      new Promise((resolveLine, rejectLine) => {
        pending.push((line) => {
          if (/^[2345]\d\d/.test(line)) resolveLine(line);
          else rejectLine(new Error(line.trim()));
        });
      });
    const send = (cmd: string): void => {
      socket.write(cmd + "\r\n");
    };

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        // Multi-line replies (EHLO) use "<code>-" continuation lines — fold
        // them: only the FINAL "<code> " line resolves the pending reply.
        if (/^\d{3}-/.test(line)) continue;
        const handler = pending.shift();
        if (handler) handler(line);
        else finish({ ok: false, error: `Unexpected SMTP reply: ${line.trim()}` });
      }
    });
    socket.on("error", (err: Error) => {
      clearTimeout(timer);
      finish({ ok: false, error: `SMTP socket error: ${err.message}` });
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (!settled) finish({ ok: false, error: "SMTP connection closed unexpectedly" });
    });

    void (async () => {
      try {
        // Queue every reply-wait SYNCHRONOUSLY right after its command: socket
        // data is processed on a later event-loop turn, so the handler is
        // always queued before the reply can arrive.
        const greeting = nextReply();
        send(`EHLO constellation.local`);
        const ehlo = nextReply();
        await greeting;
        await ehlo;
        if (opts.user && opts.pass) {
          const cred = Buffer.from(`${opts.user}\0${opts.user}\0${opts.pass}`).toString("base64");
          send(`AUTH PLAIN ${cred}`);
          const auth = nextReply();
          await auth;
        }
        send(`MAIL FROM:<${opts.from}>`);
        const mail = nextReply();
        await mail;
        for (const recipient of to) {
          send(`RCPT TO:<${recipient}>`);
          const rcpt = nextReply();
          await rcpt;
        }
        send("DATA");
        const dataGo = nextReply();
        await dataGo;
        const body = [
          `From: ${opts.from}`,
          `To: ${to.join(", ")}`,
          `Subject: ${opts.subject}`,
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=utf-8",
          "",
          opts.text.replace(/^\./gm, ".."),
        ].join("\r\n");
        send(`${body}\r\n.`);
        const queued = nextReply();
        await queued;
        send("QUIT");
        clearTimeout(timer);
        finish({ ok: true });
      } catch (err) {
        clearTimeout(timer);
        socket.destroy();
        finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}

// A tiny SMTP server for tests: takes every message and keeps it, so a test
// can read what Audition emailed. Plain text only, no TLS, no auth.
import type { Socket } from "bun";

export interface Mail { from: string; to: string[]; data: string; subject: string; body: string }
export interface Sink { port: number; mails: Mail[]; stop(): void; waitFor(pred: (m: Mail) => boolean, ms?: number): Promise<Mail> }

interface S { buf: string; from: string; to: string[]; inData: boolean; data: string[] }

function parse(raw: string): { subject: string; body: string } {
  const [head = "", ...rest] = raw.split(/\r?\n\r?\n/);
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  const subject = /^subject:\s*(.*)$/im.exec(unfolded)?.[1] ?? "";
  let body = rest.join("\n\n");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    body = new TextDecoder().decode(Uint8Array.from(body, (c) => c.charCodeAt(0)));
  }
  return { subject, body: body.replace(/\r\n/g, "\n") };
}

export function startSink(): Sink {
  const mails: Mail[] = [];
  const server = Bun.listen<S>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(s: Socket<S>) { s.data = { buf: "", from: "", to: [], inData: false, data: [] }; s.write("220 sink ESMTP\r\n"); },
      data(s: Socket<S>, chunk) {
        const st = s.data;
        st.buf += chunk.toString();
        let i: number;
        while ((i = st.buf.indexOf("\r\n")) >= 0) {
          const line = st.buf.slice(0, i);
          st.buf = st.buf.slice(i + 2);
          if (st.inData) {
            if (line === ".") {
              const data = st.data.join("\r\n");
              mails.push({ from: st.from, to: st.to, data, ...parse(data) });
              st.inData = false; st.data = []; st.to = []; st.from = "";
              s.write("250 OK\r\n");
            } else st.data.push(line.startsWith("..") ? line.slice(1) : line);
            continue;
          }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === "EHLO") s.write("250-sink\r\n250 8BITMIME\r\n");
          else if (cmd === "HELO") s.write("250 sink\r\n");
          else if (cmd === "MAIL") { st.from = line.replace(/^MAIL FROM:\s*/i, "").replace(/[<>]/g, "").split(" ")[0] ?? ""; s.write("250 OK\r\n"); }
          else if (cmd === "RCPT") { st.to.push(line.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, "").split(" ")[0] ?? ""); s.write("250 OK\r\n"); }
          else if (cmd === "DATA") { st.inData = true; s.write("354 go on\r\n"); }
          else if (cmd === "QUIT") { s.write("221 bye\r\n"); s.end(); }
          else s.write("250 OK\r\n");
        }
      },
    },
  });
  return {
    port: server.port,
    mails,
    stop: () => server.stop(true),
    async waitFor(pred, ms = 15000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = mails.find(pred);
        if (m) return m;
        await Bun.sleep(100);
      }
      throw new Error(`no matching email in ${ms} ms; got: ${mails.map((m) => m.subject).join(" | ") || "none"}`);
    },
  };
}

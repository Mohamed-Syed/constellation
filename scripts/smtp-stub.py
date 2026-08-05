#!/usr/bin/env python3
"""Tiny SMTP stub for the notification-channels SMTP live proof.
Accepts a minimal conversation (EHLO/AUTH PLAIN/MAIL/RCPT/DATA) and records
the raw message to a log file. Usage: python smtp-stub.py <port> <logfile>"""
import socket, sys, datetime

port = int(sys.argv[1])
LOG = sys.argv[2]

def log(line):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def handle(conn, addr):
    f = conn.makefile("rwb", buffering=0)
    def send(line):
        f.write((line + "\r\n").encode())
    send("220 smtp-stub ESMTP ready")
    data = []
    in_data = False
    while True:
        raw = f.readline()
        if not raw:
            break
        line = raw.decode("utf-8", "replace").rstrip("\r\n")
        if in_data:
            if line == ".":
                in_data = False
                send("250 OK: queued")
                body = "\n".join(data)
                log(f"=== MESSAGE {datetime.datetime.now().isoformat()} ===")
                log(body)
                log("=== END ===")
                data = []
            else:
                data.append(line)
            continue
        cmd = line.upper()
        if cmd.startswith("EHLO"):
            send("250-smtp-stub")
            send("250 AUTH PLAIN")
        elif cmd.startswith("AUTH"):
            send("235 2.7.0 Accepted")
        elif cmd.startswith("MAIL FROM"):
            send("250 2.1.0 Ok")
        elif cmd.startswith("RCPT TO"):
            send("250 2.1.5 Ok")
        elif cmd == "DATA":
            in_data = True
            send("354 End data with <CR><LF>.<CR><LF>")
        elif cmd == "QUIT":
            send("221 Bye")
            break
        else:
            send("250 Ok")
    conn.close()

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", port))
srv.listen(5)
log(f"SMTP stub listening on 127.0.0.1:{port}")
while True:
    conn, addr = srv.accept()
    try:
        handle(conn, addr)
    except Exception as e:  # noqa: BLE001
        log(f"error: {e}")

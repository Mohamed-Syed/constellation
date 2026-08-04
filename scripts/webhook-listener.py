#!/usr/bin/env python3
"""Tiny local webhook listener for the notification-channels live proof.
Records every POST body (with path + timestamp) to a log file; answers 200.
Usage: python webhook-listener.py <port> <logfile>"""
import http.server
import datetime
import sys


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9080
    log = sys.argv[2] if len(sys.argv) > 2 else "webhooks.log"

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8", "replace")
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"{datetime.datetime.now().isoformat()} {self.path} {body}\n")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args: object) -> None:
            pass

    http.server.HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()

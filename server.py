"""
Sault Skill Survey — tiny static dev server (standard library only).

Serves index.html and the static assets in this folder. Caching is disabled
so edits to app.css / app.js / survey-data.js show up on a plain refresh.

Usage:
    python server.py            # serves on http://localhost:8000
    python server.py 5500       # serves on a custom port
"""

import http.server
import os
import socketserver
import sys
import webbrowser

# Always serve from the folder this script lives in, no matter where it's run.
ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Disable caching during development.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Quieter, friendlier request log.
        print("  %s - %s" % (self.address_string(), fmt % args))


def main():
    url = f"http://localhost:{PORT}/index.html"
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print("\n  Sault Skill Survey is running")
        print(f"  ->  {url}")
        print(f"  ->  admin: http://localhost:{PORT}/index.html#/admin  (passcode: algoma)")
        print("\n  Press Ctrl+C to stop.\n")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped.\n")


if __name__ == "__main__":
    main()

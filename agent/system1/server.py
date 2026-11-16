"""System 1 decision server for the Ticket Intelligence agent (docs/SYSTEM1_PLAN.md).

One fine-tuned Laya checkpoint, answering on 127.0.0.1 only, with the Hugging Face hub offline: no ticket text and
no request leaves this machine. The watcher starts it (agent/lib/system1.mjs) and reuses it across restarts.
Not laya-serve: that one listens on every interface by default and routes between checkpoints by language, and the
agent needs exactly its own checkpoint for every ticket.

    python -I server.py --checkpoint DIR --port 7071 [--threads N]

GET  /health  -> {"ok": true, "checkpoint": DIR, "loadSeconds": 8.1, "pid": 1234}
POST /decide  {"state": "text", "questions": {...laya questions...}} -> {"answers": {...}, "ms": 1284.5}
"""
import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("USE_TF", "0")

MAX_BODY = 64_000  # a ticket's title and description, cut by the client, and the questions


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--port", type=int, default=7071)
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()
    checkpoint = os.path.abspath(args.checkpoint)

    import laya  # noqa: E402  (after the environment above)
    import torch  # noqa: E402

    if args.threads > 0:
        torch.set_num_threads(args.threads)
    started = time.perf_counter()
    agent = laya.load(checkpoint, device="cpu")
    load_seconds = round(time.perf_counter() - started, 1)

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, body):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                return self._send(200, {"ok": True, "checkpoint": checkpoint, "loadSeconds": load_seconds, "pid": os.getpid(), "threads": torch.get_num_threads()})
            return self._send(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path != "/decide":
                return self._send(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send(413, {"error": f"body must be 1..{MAX_BODY} bytes"})
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                return self._send(400, {"error": "body is not JSON"})
            state, questions = body.get("state"), body.get("questions")
            if not isinstance(state, str) or not isinstance(questions, dict) or not questions:
                return self._send(400, {"error": "expected {state: string, questions: object}"})
            try:
                t = time.perf_counter()
                result = agent.predict(state, questions)
                return self._send(200, {"answers": result["answers"], "ms": round(1000 * (time.perf_counter() - t), 1)})
            except ValueError as e:  # a question laya cannot use, named by laya
                return self._send(422, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                print(f"decide failed: {e!r}", file=sys.stderr, flush=True)
                return self._send(500, {"error": "inference failed"})

        def log_message(self, *_):  # quiet: the watcher logs what matters as events
            pass

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"system1 ready on 127.0.0.1:{args.port} · {checkpoint} · loaded in {load_seconds} s", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

"""Non-production 40-client smoke test against an already running Compose stack.

Measures local throughput and failure rate. It is not a substitute for public VPS
performance testing with real mobile networks or HTTPS.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookies import SimpleCookie
from statistics import mean
from time import monotonic
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import json
import secrets

BASE = "http://127.0.0.1:8788"


def request(path, method="GET", data=None, cookie=None):
    headers = {}
    if cookie:
        headers["Cookie"] = cookie
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    started = monotonic()
    with urlopen(Request(BASE + path, data=body, headers=headers, method=method), timeout=8) as res:
        payload = res.read()
        return res, payload, monotonic() - started


def main():
    username = "load" + secrets.token_hex(4)
    res, _, _ = request("/api/auth/register", "POST", {"username": username, "password": "load-test-passphrase-123"})
    jar = SimpleCookie()
    jar.load(res.headers["Set-Cookie"])
    session = "randly_session=" + jar["randly_session"].value
    _, payload, _ = request("/api/rooms", "POST",
                             {"title": "40 viewer smoke test", "min_value": 1, "max_value": 9,
                              "no_repeats": True}, cookie=session)
    code = json.loads(payload)["code"]
    _, payload, _ = request("/api/rooms/" + code + "/draw", "POST", {}, cookie=session)
    assert 1 <= json.loads(payload)["number"] <= 9

    def visitor(_):
        timings = []
        for _ in range(5):
            for path in ("/api/rooms/" + code, "/"):
                _, content, seconds = request(path)
                if not content:
                    raise AssertionError("Empty response")
                timings.append(seconds)
        return timings

    errors = []
    latencies = []
    started = monotonic()
    with ThreadPoolExecutor(max_workers=40) as pool:
        futures = [pool.submit(visitor, i) for i in range(40)]
        for future in as_completed(futures):
            try:
                latencies.extend(future.result())
            except Exception as exc:
                errors.append(repr(exc))
    elapsed = monotonic() - started
    samples = len(latencies)
    p95 = sorted(latencies)[int((samples - 1) * 0.95)] if samples else float("inf")
    print(f"40 concurrent visitors; {samples} requests; {len(errors)} visitors failed")
    print(f"Time {elapsed:.2f}s, avg {mean(latencies) if samples else 0:.3f}s, "
          f"p95 {p95:.3f}s, {samples / elapsed:.1f} req/s")
    for err in errors[:5]:
        print("ERROR:", err)
    if errors:
        raise SystemExit("40-client smoke test failed")


if __name__ == "__main__":
    main()

"""Generate the policy for the current inline module; --check is read-only.

Run after editing index.html. External scripts are self-hosted; inline scripts
must match an explicit SHA-256 hash, so unsafe-inline is never enabled for JS.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re


def policy_for(html):
    hashes = []
    for attrs, source in re.findall(r'<script\b([^>]*)>([\s\S]*?)</script>', html, re.I):
        if not re.search(r'\bsrc\s*=', attrs, re.I) and source.strip():
            digest = base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
            hashes.append("'sha256-" + digest + "'")
    return "; ".join([
        "default-src 'self'", "script-src 'self' " + " ".join(hashes),
        "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
        "connect-src 'self' https: wss:", "object-src 'none'", "base-uri 'self'",
        "form-action 'self'", "frame-src 'none'", "worker-src 'self'", "upgrade-insecure-requests",
    ])


def update(html):
    tag = '<meta http-equiv="Content-Security-Policy" content="' + policy_for(html) + '">'
    pattern = r'<meta http-equiv="Content-Security-Policy" content="[^"]*">'
    if re.search(pattern, html):
        return re.sub(pattern, lambda _: tag, html, count=1)
    return html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + tag, 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    path = root / 'index.html'
    original = path.read_text()
    expected = update(original)
    config_path = root / 'vercel.json'
    config = json.loads(config_path.read_text()) if config_path.exists() else None
    headers = [
        {'key': 'Content-Security-Policy', 'value': policy_for(expected) + "; frame-ancestors 'none'"},
        {'key': 'X-Frame-Options', 'value': 'DENY'},
        {'key': 'X-Content-Type-Options', 'value': 'nosniff'},
        {'key': 'Referrer-Policy', 'value': 'strict-origin-when-cross-origin'},
        {'key': 'Permissions-Policy', 'value': 'camera=(), microphone=(), geolocation=()'},
    ]
    configured = config is None or any(r.get('source') == '/(.*)' and r.get('headers') == headers for r in config.get('headers', []))
    if args.check:
        if original != expected or not configured:
            raise SystemExit('Run python3 scripts/update_csp.py to refresh the policy before publishing.')
        print('CSP matches the application scripts.')
    else:
        path.write_text(expected)
        if config is not None:
            existing = [r for r in config.get('headers', []) if r.get('source') != '/(.*)']
            config['headers'] = existing + [{'source': '/(.*)', 'headers': headers}]
            config_path.write_text(json.dumps(config, indent=2) + '\n')

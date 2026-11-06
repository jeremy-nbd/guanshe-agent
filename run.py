"""Start the complete local application with Python 3.11+."""

import argparse

import uvicorn


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='观舌 · 网页健康观察 Agent')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=3210)
    args = parser.parse_args()
    uvicorn.run('guanshe.server:app', host=args.host, port=args.port, proxy_headers=False)

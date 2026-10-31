"""Serve the repository root for the Catch-It UI preview (standard library only)."""
import http.server
import os
import socketserver
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

class PreviewServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    port = 8080
    while True:
        try:
            server = PreviewServer(('0.0.0.0', port), http.server.SimpleHTTPRequestHandler)
            break
        except OSError as exc:
            if exc.errno not in (48, 98, 10048):
                raise
            port += 1
    url = f'http://localhost:{port}/web/index.html'
    print(f'Catch-It preview: {url} (Ctrl+C to stop)', flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nPreview stopped.')
    finally:
        server.server_close()

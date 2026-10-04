# Serves the repo root for the preview harness (.mjs needs a JS MIME type,
# and no caching so edits show up on reload).
# Run from the repo root: python .impeccable/harness/serve.py
import http.server


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'  # keep-alive: avoids Windows socket exhaustion (ERR_NO_BUFFER_SPACE)
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.js': 'text/javascript'}

    def send_head(self):
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.test(HandlerClass=Handler, port=8765, bind='127.0.0.1')

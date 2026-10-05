"""Shared headless Firefox lifecycle for the read-only local UI checks."""
from contextlib import contextmanager, suppress
import json
import socket
import subprocess
import time
import urllib.error
import urllib.request


class Browser:
    def __init__(self, base):
        self.base = base
        self.session = None

    def request(self, method, path, data=None):
        body = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(self.base + path, body,
                                         {'Content-Type': 'application/json'}, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)['value']
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from error

    def execute(self, script):
        return self.request('POST', f'/session/{self.session}/execute/sync',
                            {'script': script, 'args': []})

    def resize(self, width, height):
        self.request('POST', f'/session/{self.session}/window/rect',
                     {'width': width, 'height': height})


@contextmanager
def browser_session():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    browser = Browser(f'http://127.0.0.1:{port}')
    driver = subprocess.Popen(['geckodriver', '--port', str(port)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for attempt in range(40):
            try:
                browser.request('GET', '/status')
                break
            except (OSError, RuntimeError):
                if driver.poll() is not None or attempt == 39:
                    raise
                time.sleep(0.25)
        browser.session = browser.request('POST', '/session', {'capabilities': {'alwaysMatch': {
            'browserName': 'firefox', 'moz:firefoxOptions': {'args': ['-headless']},
        }}})['sessionId']
        browser.request('POST', f'/session/{browser.session}/url', {'url': 'http://127.0.0.1:8000/'})
        time.sleep(5)
        yield browser
    finally:
        if browser.session:
            with suppress(Exception):
                browser.request('DELETE', f'/session/{browser.session}')
        with suppress(PermissionError):
            driver.terminate()
            try:
                driver.wait(timeout=10)
            except subprocess.TimeoutExpired:
                driver.kill()
                driver.wait(timeout=10)

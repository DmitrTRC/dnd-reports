#!/usr/bin/env python3
"""Локальный сервер для PWA «Отчёты ДНД».

Service worker и загрузка шрифтов требуют http(s), поэтому открывать
index.html напрямую (file://) нельзя — запустите этот сервер.

    python3 serve.py            # http://localhost:8000
    python3 serve.py 9000       # другой порт

Затем откройте адрес в браузере и при желании «Установите» приложение
(значок в адресной строке Chrome / «Добавить на экран Домой» на телефоне).
"""
import http.server
import socketserver
import sys
import os
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.ttf': 'font/ttf',
        '.webmanifest': 'application/manifest+json',
    }

    def end_headers(self):
        self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()


with socketserver.TCPServer(('', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}/index.html'
    print(f'Отчёты ДНД → {url}\nCtrl+C для остановки.')
    try:
        webbrowser.open(url)
    except Exception:
        pass
    httpd.serve_forever()

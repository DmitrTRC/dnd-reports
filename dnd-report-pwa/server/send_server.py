#!/usr/bin/env python3
"""Сервер отправки отчётов ДНД «в один клик».

Делает две вещи одновременно:
  1. Раздаёт само PWA (статические файлы из родительской папки).
  2. Принимает POST /api/send и отправляет письмо с вложённым PDF по SMTP.

Зависимостей нет — только стандартная библиотека Python 3.

Запуск:
    cd dnd-report-pwa
    cp server/email_config.example.json server/email_config.json
    # отредактируйте email_config.json (SMTP-доступ вашего ящика)
    python3 server/send_server.py            # http://localhost:8000
    python3 server/send_server.py 9000       # другой порт

После этого в приложении кнопка «✉ Отправить» уходит в один клик
(в настройках Почта оставьте «URL сервела отправки» пустым — берётся
этот же адрес).

API:
    GET  /api/health  -> {"ok": true, "configured": bool}
    POST /api/send    -> {to, subject, body, filename, pdf_base64}
                         {"ok": true} | {"ok": false, "error": "..."}
"""
import base64
import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.dirname(BASE_DIR)                    # корень PWA
CONFIG_PATH = os.path.join(BASE_DIR, 'email_config.json')
MAX_BODY = 25 * 1024 * 1024                             # 25 МБ лимит запроса


def load_config():
    if not os.path.exists(CONFIG_PATH):
        return None
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def send_email(cfg, to_addr, subject, body, filename, pdf_bytes):
    msg = EmailMessage()
    from_name = cfg.get('from_name', '')
    from_addr = cfg.get('from_addr') or cfg.get('smtp_user')
    msg['From'] = f'{from_name} <{from_addr}>' if from_name else from_addr
    msg['To'] = to_addr
    msg['Subject'] = subject
    msg.set_content(body or '')
    if pdf_bytes:
        msg.add_attachment(pdf_bytes, maintype='application', subtype='pdf',
                           filename=filename or 'report.pdf')

    host = cfg['smtp_host']
    port = int(cfg.get('smtp_port', 465))
    user = cfg.get('smtp_user')
    password = cfg.get('smtp_password')

    if cfg.get('smtp_ssl', port == 465):
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as s:
            if user:
                s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as s:
            if cfg.get('smtp_starttls', True):
                s.starttls(context=ssl.create_default_context())
            if user:
                s.login(user, password)
            s.send_message(msg)


class Handler(SimpleHTTPRequestHandler):
    # раздаём из корня PWA
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.ttf': 'font/ttf',
        '.webmanifest': 'application/manifest+json',
    }

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def end_headers(self):
        self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/api/health':
            cfg = load_config()
            return self._json(200, {'ok': True, 'configured': bool(cfg)})
        return super().do_GET()

    def do_POST(self):
        if self.path.split('?')[0] != '/api/send':
            return self._json(404, {'ok': False, 'error': 'not found'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > MAX_BODY:
                return self._json(413, {'ok': False, 'error': 'тело запроса пустое или слишком большое'})
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception as e:
            return self._json(400, {'ok': False, 'error': f'плохой JSON: {e}'})

        cfg = load_config()
        if not cfg:
            return self._json(500, {'ok': False, 'error': 'server/email_config.json не настроен'})

        to_addr = (payload.get('to') or '').strip()
        if not to_addr:
            return self._json(400, {'ok': False, 'error': 'не указан адресат'})

        allowed = cfg.get('allowed_recipients') or []
        if allowed and to_addr not in allowed:
            return self._json(403, {'ok': False, 'error': 'адресат вне разрешённого списка'})

        pdf_bytes = b''
        if payload.get('pdf_base64'):
            try:
                pdf_bytes = base64.b64decode(payload['pdf_base64'])
            except Exception as e:
                return self._json(400, {'ok': False, 'error': f'битое вложение: {e}'})

        try:
            send_email(cfg, to_addr, payload.get('subject', ''), payload.get('body', ''),
                       payload.get('filename', 'report.pdf'), pdf_bytes)
        except Exception as e:
            return self._json(502, {'ok': False, 'error': f'SMTP: {e}'})

        return self._json(200, {'ok': True})

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(WEB_ROOT)
    cfg = load_config()
    status = 'SMTP настроен' if cfg else 'SMTP НЕ настроен (скопируйте email_config.example.json → email_config.json)'
    srv = ThreadingHTTPServer(('', port), Handler)
    print(f'Отчёты ДНД → http://localhost:{port}/index.html')
    print(f'Отправка: POST /api/send  ({status})')
    print('Ctrl+C для остановки.')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nОстановлено.')


if __name__ == '__main__':
    main()

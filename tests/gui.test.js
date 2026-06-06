'use strict';
/* Смоук-тест GUI в jsdom: загрузка, сид архива, дефолты почты, стиль, образец. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');

const APP = path.join(__dirname, '..', 'dnd-report-pwa');

function boot() {
  const vc = new VirtualConsole(); // глушим шум jsdom (canvas getContext и т.п.)
  const dom = new JSDOM(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'),
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  w.indexedDB = globalThis.indexedDB; w.IDBKeyRange = globalThis.IDBKeyRange;
  w.confirm = () => true;
  class FI { set src(v) { this.naturalWidth = 200; this.naturalHeight = 160; if (this.onload) setTimeout(() => this.onload(), 0); } }
  w.Image = FI;
  class FR { readAsDataURL() { this.result = 'data:image/png;base64,iVBORw0KGgo='; if (this.onload) setTimeout(() => this.onload(), 0); } }
  w.FileReader = FR;
  w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  w.fetch = async (u) => {
    const b = fs.readFileSync(path.join(APP, String(u).replace(/^\.?\//, '')));
    return { ok: true, json: async () => JSON.parse(b.toString()), text: async () => b.toString(), blob: async () => ({}), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  ['js/report-pdf.js', 'js/layout-modern.js', 'js/store.js', 'js/preview.js', 'js/app.js']
    .forEach((f) => w.eval(fs.readFileSync(path.join(APP, f), 'utf8')));
  return w;
}

function waitFor(fn, timeout = 6000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function loop() {
      let v; try { v = fn(); } catch (e) { v = null; }
      if (v) { return res(v); }
      if (Date.now() - t0 > timeout) { return rej(new Error('timeout')); }
      setTimeout(loop, 30);
    })();
  });
}

test('GUI загружается, сидирует архив, проставляет дефолты', async () => {
  const w = boot(); const d = w.document;
  await waitFor(() => d.querySelectorAll('#history li').length >= 10);
  assert.equal(d.getElementById('sStyle').value, 'modern', 'стиль по умолчанию — Модерн');
  assert.equal(d.getElementById('eSender').value, '9984398@gmail.com', 'отправитель по умолчанию');
  const sendVals = [...d.querySelectorAll('#sendTo option')].map((o) => o.value).filter(Boolean);
  assert.ok(sendVals.includes('baev-gmto@yandex.ru'), 'адресат по умолчанию в списке');
});

test('заполнение по образцу прошлого месяца', async () => {
  const w = boot(); const d = w.document;
  await waitFor(() => !d.getElementById('btnTemplate').hidden);
  d.getElementById('btnTemplate').click();
  await waitFor(() => d.querySelector('#acts .act-text') && d.querySelector('#acts .act-text').value.length > 0);
  assert.ok(d.querySelectorAll('#acts .act').length >= 1, 'пункты заполнились образцом');
});

test('превью «Модерн» рендерится без ошибок', async () => {
  const w = boot(); const d = w.document;
  await waitFor(() => d.querySelector('#history li .h-main'));
  d.querySelector('#history li .h-main').click();
  await waitFor(() => d.querySelector('#preview .sheet'));
  const sheet = d.querySelector('#preview .sheet');
  assert.ok(sheet.children.length > 0, 'на листе есть элементы');
});

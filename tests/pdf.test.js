'use strict';
/* Тесты движка PDF и вёрстки «Модерн» (без браузера). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'dnd-report-pwa');

// Окружение, как в браузере: глобалы window/PDFLib/fontkit/fetch
global.window = global;
global.PDFLib = require('pdf-lib');
global.fontkit = require('@pdf-lib/fontkit');
global.fetch = async (u) => {
  const p = path.join(APP, String(u).replace(/^\.?\//, ''));
  const b = fs.readFileSync(p);
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
require(path.join(APP, 'js', 'report-pdf.js'));
require(path.join(APP, 'js', 'layout-modern.js'));

const consts = JSON.parse(fs.readFileSync(path.join(APP, 'samples', '_constants.json'), 'utf8'));
const may = JSON.parse(fs.readFileSync(path.join(APP, 'samples', 'Lukomorie_May_2026__report.json'), 'utf8'));
const report = Object.assign({}, consts, may);
const logo = new Uint8Array(fs.readFileSync(path.join(APP, 'icons', 'emblem.png')));
const isPdf = (bytes) => Buffer.from(bytes.slice(0, 5)).toString() === '%PDF-';

test('перенос строк и нумерация пунктов', () => {
  const lines = window.ReportPDF._wrapText('один два три четыре пять шесть семь', 12);
  assert.ok(lines.length >= 2, 'длинный текст переносится');
  const flat = window.ReportPDF._flatten([{ text: 'Главный пункт', subitems: ['альфа', 'бета'] }]);
  assert.equal(flat[0].text.startsWith('1. '), true, 'пункт нумеруется как «1. »');
  assert.equal(flat[1].text.startsWith('1) '), true, 'подпункт нумеруется как «1) »');
});

test('классический PDF — валидные байты', async () => {
  const bytes = await window.ReportPDF.generate(report, { logoBytes: logo, config: { style: 'classic' } });
  assert.ok(bytes.length > 2000, 'PDF не пустой');
  assert.ok(isPdf(bytes), 'начинается с %PDF-');
});

test('PDF «Модерн» — валидные байты', async () => {
  const bytes = await window.ReportPDF.generate(report, { logoBytes: logo, config: { style: 'modern' } });
  assert.ok(bytes.length > 2000, 'PDF не пустой');
  assert.ok(isPdf(bytes), 'начинается с %PDF-');
});

test('вёрстка «Модерн» разбивается на страницы', () => {
  const cfg = { style: 'modern', colours: window.ReportPDF.DEFAULT_CONFIG.colours };
  const built = window.LayoutModern.build(report, cfg);
  assert.ok(built.pageCount >= 1, 'есть хотя бы одна страница');
  assert.ok(Array.isArray(built.pages[0]) && built.pages[0].length > 0, 'на странице есть операции');
  // в этом отчёте 8 пунктов — должно получиться 2 страницы
  assert.equal(built.pageCount, 2, 'отчёт за май занимает 2 страницы');
});

test('пустой отчёт не падает', async () => {
  const empty = Object.assign({}, consts, { month: 'Июнь', year: 2026, activities: [] });
  const bytes = await window.ReportPDF.generate(empty, { logoBytes: logo, config: { style: 'modern' } });
  assert.ok(isPdf(bytes));
});

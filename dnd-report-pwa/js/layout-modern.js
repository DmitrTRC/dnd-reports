/*
 * layout-modern.js — вёрстка «Модерн» как абстрактный список операций.
 *
 * Одна логика для PDF (report-pdf.js) и живого превью (preview.js): функция
 * build() возвращает массив страниц, каждая — список операций отрисовки в
 * точках, с координатой Y, отсчитываемой СВЕРХУ (0 — верх страницы).
 * Рендереры сами переводят это в pdf-lib или в DOM.
 *
 * Типы операций:
 *   {t:'rect',   x,y,w,h, fill, stroke?, sw?}
 *   {t:'line',   x1,y1,x2,y2, stroke, width}
 *   {t:'circle', cx,cy,r, fill}
 *   {t:'text',   x,y, text, font:'serif'|'sans', bold?, size, color,
 *                align:'left'|'center'|'right', spacing?}
 *   {t:'image',  x,y,w,h, ref:'logo'}
 *
 * Зависит от ReportPDF._wrapText (перенос по словам), который загружается раньше.
 */
(function (global) {
  'use strict';

  const A4 = { W: 8.27 * 72, H: 11.69 * 72 }; // как в report-pdf.js

  function build(report, cfg) {
    const W = A4.W, H = A4.H;
    const c = (cfg && cfg.colours) || {};
    const P = {
      green: c.green_dark || '#0B4F37',
      ink: '#16241d',
      body: c.body_text || '#212121',
      muted: '#6c7a72',
      faint: '#8a958d',
      gold: '#B8862B',
      goldBright: c.accent_yellow || '#F6C744',
      chip: '#f1f6f1',
      chipBorder: '#e0e8e0',
      hair: '#eef1ee',
      timeline: '#cfe0d6',
      dash: '#3B8C63',
      white: '#ffffff',
    };
    const L = Object.assign({
      reportTitle: 'Отчёт за {month} {year}',
      sectionHeading: 'За {month} {year} проведено:',
      signatureTitle: 'Командир Добровольной Народной Дружины:',
    }, report.labels || {});
    const tpl = (s) => String(s).replace(/\{month\}/g, report.month).replace(/\{year\}/g, report.year);

    const ML = 54, MR = 54, CR = W - MR;          // левый/правый отступ, правый край
    const DISC_X = ML + 18, TITLE_X = ML + 44, SUB_X = ML + 66;
    const titleWrapW = CR - TITLE_X;
    const subWrapW = CR - SUB_X;
    const KS = 0.56;                                // оценка ширины символа (доля кегля)
    const mc = (size, avail) => Math.max(8, Math.floor(avail / (size * KS)));
    const wrap = (text, size, avail) => ReportPDF._wrapText(text || '', mc(size, avail));

    const activities = (report.activities || [])
      .map((a) => ({ text: (a.text || '').trim(), subitems: (a.subitems || []).map((s) => (s || '').trim()).filter(Boolean) }))
      .filter((a) => a.text || a.subitems.length);

    // --- предварительный обмер блоков ---
    const TITLE_LH = 15, SUB_LH = 14.5;
    const blocks = activities.map((a, i) => {
      const titleLines = wrap(a.text, 12, titleWrapW);
      const subs = a.subitems.map((s) => ({ lines: wrap(s, 10.5, subWrapW) }));
      const h = 11 + titleLines.length * TITLE_LH + subs.reduce((n, s) => n + s.lines.length * SUB_LH, 0) + 13;
      return { num: i + 1, titleLines, subs, h };
    });

    // --- шапка 1-й страницы считается динамически, чтобы реквизиты влезли полностью ---
    const RULE_Y = 98, REG_Y = 111, REG_STEP = 10.5, CHIPS_H = 40;
    const regLines = [];
    (report.small_lines || []).filter(Boolean).forEach((l) => wrap(l, 8, CR - ML).forEach((x) => regLines.push(x)));
    const regBottom = regLines.length ? REG_Y + (regLines.length - 1) * REG_STEP : RULE_Y;
    const KICKER_Y = regLines.length ? regBottom + 19 : 122;
    const TITLE_Y = KICKER_Y + 28;
    const SUB_Y = TITLE_Y + 18;
    const CHIPS_Y = SUB_Y + 14;
    const LIST_TOP1 = CHIPS_Y + CHIPS_H + 22;

    // --- пагинация ---
    const LIST_TOP2 = 96, FOOT_RULE = H - 72, BOTTOM = FOOT_RULE - 16;
    const pages = [];
    let cur = [], y = LIST_TOP1;
    for (const b of blocks) {
      if (cur.length && y + b.h > BOTTOM) { pages.push(cur); cur = []; y = LIST_TOP2; }
      b.y = y; cur.push(b); y += b.h;
    }
    pages.push(cur);
    const pageCount = pages.length;

    const totalSubs = activities.reduce((n, a) => n + a.subitems.length, 0);
    const dd = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; })();

    // --- сборка операций для каждой страницы ---
    return {
      pageCount,
      pages: pages.map((items, pi) => buildPageOps(items, pi)),
    };

    function buildPageOps(items, pi) {
      const ops = [];
      const first = pi === 0;

      // ---- ШАПКА ----
      if (first) {
        ops.push({ t: 'image', x: ML, y: 42, h: 54, ref: 'logo' });
        ops.push({ t: 'text', x: ML + 58, y: 62, text: report.organization || '', font: 'serif', size: 18, color: P.green, align: 'left' });
        ops.push({ t: 'text', x: ML + 58, y: 80, text: join(report.station, report.team_name), font: 'sans', size: 9.5, color: P.muted, align: 'left' });
        ops.push({ t: 'line', x1: ML, y1: RULE_Y, x2: CR, y2: RULE_Y, stroke: P.gold, width: 1.3 });
        regLines.forEach((ln, i) => ops.push({ t: 'text', x: ML, y: REG_Y + i * REG_STEP, text: ln, font: 'sans', size: 8, color: P.faint, align: 'left' }));
        ops.push({ t: 'text', x: ML, y: KICKER_Y, text: 'ежемесячный отчёт', font: 'sans', size: 9, color: P.gold, align: 'left', spacing: 2.4 });
        ops.push({ t: 'text', x: ML, y: TITLE_Y, text: `${report.month} ${report.year}`, font: 'serif', size: 26, color: P.ink, align: 'left' });
        ops.push({ t: 'text', x: ML, y: SUB_Y, text: tpl(L.sectionHeading), font: 'sans', size: 10.5, color: P.muted, align: 'left' });
        // карточки-сводка
        const gap = 12, cw = (CR - ML - 2 * gap) / 3, cy = CHIPS_Y, ch = CHIPS_H;
        numChip(0, String(activities.length), 'мероприятий', 'проведено');
        numChip(1, String(totalSubs), 'подпунктов', 'выполнено');
        periodChip(2, report.month, `${report.year} · отчётный период`);
        function numChip(idx, big, l1, l2) {
          const x = ML + idx * (cw + gap);
          ops.push({ t: 'rect', x, y: cy, w: cw, h: ch, fill: P.chip, stroke: P.chipBorder, sw: 1 });
          ops.push({ t: 'text', x: x + 14, y: cy + 27, text: big, font: 'serif', size: 19, color: P.green, align: 'left' });
          ops.push({ t: 'text', x: x + 44, y: cy + 18, text: l1, font: 'sans', size: 9.5, color: '#52605a', align: 'left' });
          ops.push({ t: 'text', x: x + 44, y: cy + 31, text: l2, font: 'sans', size: 9.5, color: '#52605a', align: 'left' });
        }
        function periodChip(idx, big, sub) {
          const x = ML + idx * (cw + gap);
          ops.push({ t: 'rect', x, y: cy, w: cw, h: ch, fill: P.green });
          ops.push({ t: 'text', x: x + 16, y: cy + 19, text: big, font: 'serif', size: 15, color: P.goldBright, align: 'left' });
          ops.push({ t: 'text', x: x + 16, y: cy + 32, text: sub, font: 'sans', size: 8.5, color: '#cfe0d6', align: 'left' });
        }
      } else {
        ops.push({ t: 'image', x: ML, y: 32, h: 36, ref: 'logo' });
        ops.push({ t: 'text', x: ML + 40, y: 54, text: report.organization || '', font: 'serif', size: 13, color: P.green, align: 'left' });
        ops.push({ t: 'text', x: ML + 40, y: 68, text: `${report.month} ${report.year} · продолжение`, font: 'sans', size: 8.5, color: P.muted, align: 'left' });
        ops.push({ t: 'line', x1: ML, y1: 80, x2: CR, y2: 80, stroke: P.gold, width: 1.1 });
      }

      // ---- ТАЙМЛАЙН + ПУНКТЫ ----
      if (items.length) {
        const firstCy = items[0].y + 7, lastCy = items[items.length - 1].y + 7;
        ops.push({ t: 'line', x1: DISC_X, y1: firstCy, x2: DISC_X, y2: lastCy, stroke: P.timeline, width: 1.5 });
      }
      items.forEach((b, bi) => {
        const cy = b.y + 7;
        ops.push({ t: 'circle', cx: DISC_X, cy, r: 10, fill: P.gold });
        ops.push({ t: 'text', x: DISC_X, y: cy + 4, text: String(b.num), font: 'sans', bold: true, size: 11, color: P.white, align: 'center' });
        let yy = b.y + 11;
        b.titleLines.forEach((ln, i) => ops.push({ t: 'text', x: TITLE_X, y: yy + i * TITLE_LH, text: ln, font: 'sans', bold: true, size: 12, color: P.ink, align: 'left' }));
        yy += b.titleLines.length * TITLE_LH;
        b.subs.forEach((s) => {
          s.lines.forEach((ln, i) => {
            if (i === 0) { ops.push({ t: 'line', x1: ML + 48, y1: yy - 3, x2: ML + 59, y2: yy - 3, stroke: P.dash, width: 2 }); }
            ops.push({ t: 'text', x: SUB_X, y: yy + i * SUB_LH, text: ln, font: 'sans', size: 10.5, color: '#41504a', align: 'left' });
          });
          yy += s.lines.length * SUB_LH;
        });
        const isLastOnPage = bi === items.length - 1;
        if (!(isLastOnPage && pi === pageCount - 1)) {
          ops.push({ t: 'line', x1: TITLE_X, y1: b.y + b.h - 8, x2: CR, y2: b.y + b.h - 8, stroke: P.hair, width: 1 });
        }
      });

      // ---- КОЛОНТИТУЛ ----
      ops.push({ t: 'line', x1: ML, y1: FOOT_RULE, x2: CR, y2: FOOT_RULE, stroke: P.gold, width: 1.3 });
      if (pi === pageCount - 1) {
        ops.push({ t: 'text', x: ML, y: FOOT_RULE + 18, text: L.signatureTitle, font: 'sans', size: 8.5, color: P.faint, align: 'left' });
        ops.push({ t: 'text', x: ML, y: FOOT_RULE + 37, text: report.commander || '', font: 'serif', size: 13, color: P.ink, align: 'left' });
        ops.push({ t: 'line', x1: ML, y1: FOOT_RULE + 44, x2: ML + 150, y2: FOOT_RULE + 44, stroke: '#c9d2cc', width: 1 });
      }
      ops.push({ t: 'rect', x: CR - 54, y: FOOT_RULE + 12, w: 54, h: 20, fill: P.chip, stroke: P.chipBorder, sw: 1 });
      ops.push({ t: 'text', x: CR - 27, y: FOOT_RULE + 25, text: `${pi + 1} / ${pageCount}`, font: 'sans', size: 10, color: P.green, align: 'center' });
      ops.push({ t: 'text', x: CR, y: FOOT_RULE + 45, text: 'сформировано ' + dd, font: 'sans', size: 8, color: P.faint, align: 'right' });

      return ops;
    }
  }

  function join(a, b) { return [a, b].filter(Boolean).join('  ·  '); }
  function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  global.LayoutModern = { build, A4 };
})(window);

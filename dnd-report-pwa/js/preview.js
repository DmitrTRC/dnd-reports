/*
 * preview.js — живой WYSIWYG-превью страницы отчёта в HTML/CSS.
 * Использует ту же долевую геометрию, что и report-pdf.js, поэтому
 * картинка совпадает с итоговым PDF. Возвращает число страниц, чтобы
 * нарисовать пагинацию.
 */
(function (global) {
  'use strict';

  const FS = { SMALL_HEADER: 7.5, ORG_TITLE: 34, STATION_TEAM: 13, REPORT_TITLE: 24, SECTION_HEADING: 18, ACTIVITY: 11, SIGNATURE: 13 };
  const WRAP = { SMALL: 60, ACTIVITY: 80 };
  const DEFAULT_LABELS = {
    reportTitle: 'Отчёт за {month} {year}',
    sectionHeading: 'За {month} {year} проведено:',
    signatureTitle: 'Командир Добровольной Народной Дружины:',
  };
  function applyTpl(s, m, y) { return String(s).replace(/\{month\}/g, m).replace(/\{year\}/g, y); }

  function mergeConfig(base, over) {
    const out = JSON.parse(JSON.stringify(base));
    for (const k in (over || {})) {
      if (k === 'colours' && over.colours) { Object.assign(out.colours, over.colours); }
      else { out[k] = over[k]; }
    }
    return out;
  }

  function headerGeometry(cfg, isFirst) {
    const top = 1 - cfg.top_margin;
    const height = isFirst ? cfg.header_height : cfg.header_height * cfg.small_header_factor;
    return { top, bottom: top - height, height };
  }
  function calcLinesPerPage(cfg) {
    const h1 = headerGeometry(cfg, true);
    const fp = (h1.bottom - cfg.body_gap - cfg.subheading_gap - cfg.list_gap) - cfg.bottom_margin;
    const h2 = headerGeometry(cfg, false);
    const sp = (h2.bottom - cfg.body_gap) - cfg.bottom_margin;
    return Math.max(Math.floor(Math.min(fp, sp) / cfg.line_height), 1);
  }

  // Собираем все страницы как массивы «операций» {type, ...}
  function buildPages(report, cfg) {
    const flat = ReportPDF._flatten(report.activities || []);
    const total = flat.length;
    const small = [];
    (report.small_lines || []).forEach((l) => ReportPDF._wrapText(l, WRAP.SMALL).forEach((x) => small.push(x)));
    const orgTitle = prepareOrg(report.organization || '');
    const labels = Object.assign({}, DEFAULT_LABELS, report.labels || {});
    const lpp = calcLinesPerPage(cfg);

    const pages = [];
    let index = 0, pageNo = 0;
    while (index < total || pageNo === 0) {
      pageNo += 1;
      const isFirst = pageNo === 1;
      const ops = [];
      const header = headerGeometry(cfg, isFirst);
      // шапка
      ops.push({ type: 'rect', x: 0, y: header.bottom, w: 1, h: header.height, c: cfg.colours.green_dark });
      if (small.length) {
        const spacing = cfg.small_lines_reserved / small.length;
        small.forEach((ln, i) => ops.push({ type: 'text', x: cfg.content_margin, yTop: header.top - (cfg.small_lines_start + i * spacing) * header.height, t: ln, s: FS.SMALL_HEADER, c: cfg.colours.small_text }));
      }
      ops.push({ type: 'text', x: cfg.content_margin, yTop: header.top - cfg.org_line1_offset * header.height, t: orgTitle, s: FS.ORG_TITLE, c: cfg.colours.accent_yellow, b: true });

      let listStartY;
      if (isFirst) {
        ops.push({ type: 'text', x: cfg.content_margin, yTop: header.bottom + cfg.station_line_offset * header.height, t: report.station || '', s: FS.STATION_TEAM, c: cfg.colours.header_text });
        ops.push({ type: 'text', x: cfg.content_margin, yTop: header.bottom + cfg.team_line_offset * header.height, t: report.team_name || '', s: FS.STATION_TEAM, c: cfg.colours.header_text });
        if (report._logoUrl) {
          const aspect = report._logoAspect || 1;
          const adjusted = cfg.logo_height_compensation ? aspect / cfg.logo_height_compensation : aspect;
          const wFrac = cfg.logo_width_fraction;
          const hFrac = wFrac / adjusted;
          const xFrac = 1 - cfg.content_margin - wFrac;
          const yFrac = header.bottom + (header.height - hFrac) / 2;
          ops.push({ type: 'rect', x: xFrac, y: header.bottom, w: 1 - xFrac, h: header.height, c: cfg.logo_bg_colour });
          ops.push({ type: 'img', x: xFrac, y: yFrac, w: wFrac, h: hFrac, url: report._logoUrl });
        }
        const bodyTop = header.bottom - cfg.body_gap;
        ops.push({ type: 'text', x: cfg.content_margin, yTop: bodyTop, t: applyTpl(labels.reportTitle, report.month, report.year), s: FS.REPORT_TITLE, c: cfg.colours.subheader_green, b: true });
        const subY = bodyTop - cfg.subheading_gap;
        ops.push({ type: 'text', x: cfg.content_margin, yTop: subY, t: applyTpl(labels.sectionHeading, report.month, report.year), s: FS.SECTION_HEADING, c: cfg.colours.red, b: true });
        listStartY = subY - cfg.list_gap;
      } else {
        listStartY = header.bottom - cfg.body_gap;
      }

      const remaining = total - index;
      const thisPage = Math.min(remaining, lpp);
      let y = listStartY;
      for (let i = 0; i < thisPage; i++) {
        const { indent, text } = flat[index + i];
        ops.push({ type: 'text', x: cfg.content_margin + cfg.sub_indent * indent, yTop: y, t: text, s: FS.ACTIVITY, c: cfg.colours.body_text });
        y -= cfg.line_height;
      }
      index += thisPage;

      if (index >= total) {
        if ((y - cfg.signature_min_height) > cfg.bottom_margin) {
          const sigY = Math.max(y - cfg.signature_offset, cfg.bottom_margin + cfg.signature_offset);
          pushSignature(ops, cfg, sigY, report.commander, labels.signatureTitle);
        } else {
          // подпись на новой странице
          pages.push(ops);
          const ops2 = [];
          const h2 = headerGeometry(cfg, false);
          ops2.push({ type: 'rect', x: 0, y: h2.bottom, w: 1, h: h2.height, c: cfg.colours.green_dark });
          if (small.length) {
            const spacing = cfg.small_lines_reserved / small.length;
            small.forEach((ln, i) => ops2.push({ type: 'text', x: cfg.content_margin, yTop: h2.top - (cfg.small_lines_start + i * spacing) * h2.height, t: ln, s: FS.SMALL_HEADER, c: cfg.colours.small_text }));
          }
          ops2.push({ type: 'text', x: cfg.content_margin, yTop: h2.top - cfg.org_line1_offset * h2.height, t: orgTitle, s: FS.ORG_TITLE, c: cfg.colours.accent_yellow, b: true });
          pushSignature(ops2, cfg, h2.bottom - cfg.body_gap - cfg.signature_offset, report.commander, labels.signatureTitle);
          pages.push(ops2);
          return pages;
        }
      }
      pages.push(ops);
    }
    return pages;
  }

  function pushSignature(ops, cfg, yFrac, commander, title) {
    ops.push({ type: 'text', x: cfg.content_margin, yTop: yFrac, t: title || 'Командир Добровольной Народной Дружины:', s: FS.SIGNATURE, c: cfg.colours.body_text, b: true });
    ops.push({ type: 'text', x: cfg.content_margin, yTop: yFrac - cfg.signature_line_gap, t: commander || '', s: FS.SIGNATURE, c: cfg.colours.body_text });
  }

  function prepareOrg(org) {
    const s = String(org).trim();
    const i = s.indexOf(' ');
    return i === -1 ? s : s.slice(0, i) + '\n' + s.slice(i + 1);
  }

  // Рендер одной страницы в DOM
  function render(container, report, opts) {
    opts = opts || {};
    const cfg = mergeConfig(ReportPDF.DEFAULT_CONFIG, opts.config || {});
    // --- стиль «Модерн» ---
    if (cfg.style === 'modern' && global.LayoutModern) {
      return renderModern(container, report, cfg, opts);
    }
    const r = Object.assign({}, report, { _logoUrl: opts.logoUrl || null, _logoAspect: opts.logoAspect || 1 });
    const pages = buildPages(r, cfg);
    const pageIdx = Math.min(Math.max(opts.page || 0, 0), pages.length - 1);
    const ops = pages[pageIdx];

    const W = ReportPDF.A4.W; // pt
    container.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    container.appendChild(sheet);

    // масштаб: ширина sheet (px) / ширина страницы (pt)
    const px = sheet.clientWidth || container.clientWidth;
    const scale = px / W;

    for (const op of ops) {
      if (op.type === 'rect') {
        const d = document.createElement('div');
        d.className = 'op-rect';
        d.style.left = op.x * 100 + '%';
        d.style.top = (1 - (op.y + op.h)) * 100 + '%';
        d.style.width = op.w * 100 + '%';
        d.style.height = op.h * 100 + '%';
        d.style.background = op.c;
        sheet.appendChild(d);
      } else if (op.type === 'img') {
        const im = document.createElement('img');
        im.className = 'op-img';
        im.src = op.url;
        im.style.left = op.x * 100 + '%';
        im.style.top = (1 - (op.y + op.h)) * 100 + '%';
        im.style.width = op.w * 100 + '%';
        im.style.height = op.h * 100 + '%';
        sheet.appendChild(im);
      } else if (op.type === 'text') {
        const lines = String(op.t).split('\n');
        let topFrac = 1 - op.yTop;
        const stepFrac = (op.s * 1.15) / ReportPDF.A4.H;
        for (const ln of lines) {
          const s = document.createElement('div');
          s.className = 'op-text';
          s.textContent = ln;
          s.style.left = op.x * 100 + '%';
          s.style.top = topFrac * 100 + '%';
          s.style.fontSize = (op.s * scale) + 'px';
          s.style.color = op.c;
          if (op.b) { s.style.fontWeight = '700'; }
          sheet.appendChild(s);
          topFrac += stepFrac;
        }
      }
    }
    return { pageCount: pages.length, page: pageIdx };
  }

  // === DOM-рендер стиля «Модерн» из общего op-списка ===
  function renderModern(container, report, cfg, opts) {
    const built = global.LayoutModern.build(report, cfg);
    const W = global.LayoutModern.A4.W, H = global.LayoutModern.A4.H;
    const pageIdx = Math.min(Math.max(opts.page || 0, 0), built.pageCount - 1);
    const ops = built.pages[pageIdx];
    container.innerHTML = '';
    const sheet = document.createElement('div'); sheet.className = 'sheet'; container.appendChild(sheet);
    const px = sheet.clientWidth || container.clientWidth || 460;
    const scale = px / W;
    const pcW = (v) => (v / W * 100) + '%';
    const pcH = (v) => (v / H * 100) + '%';
    const el = () => { const d = document.createElement('div'); d.style.position = 'absolute'; return d; };

    for (const op of ops) {
      if (op.t === 'rect') {
        const d = el(); d.style.left = pcW(op.x); d.style.top = pcH(op.y); d.style.width = pcW(op.w); d.style.height = pcH(op.h);
        if (op.fill) { d.style.background = op.fill; } if (op.stroke) { d.style.border = '1px solid ' + op.stroke; }
        sheet.appendChild(d);
      } else if (op.t === 'line') {
        const d = el(); const horiz = Math.abs(op.y1 - op.y2) < 0.01;
        if (horiz) { d.style.left = pcW(op.x1); d.style.top = pcH(op.y1); d.style.width = pcW(op.x2 - op.x1); d.style.height = Math.max(1, (op.width || 1) * scale) + 'px'; }
        else { d.style.left = pcW(op.x1); d.style.top = pcH(op.y1); d.style.width = Math.max(1, (op.width || 1) * scale) + 'px'; d.style.height = pcH(op.y2 - op.y1); }
        d.style.background = op.stroke; sheet.appendChild(d);
      } else if (op.t === 'circle') {
        const d = el(); const dia = 2 * op.r; d.style.left = pcW(op.cx - op.r); d.style.top = pcH(op.cy - op.r);
        d.style.width = pcW(dia); d.style.height = pcH(dia); d.style.background = op.fill; d.style.borderRadius = '50%';
        sheet.appendChild(d);
      } else if (op.t === 'image') {
        if (opts.logoUrl) {
          let h = op.h, w = op.w != null ? op.w : op.h * (opts.logoAspect || 0.7);
          if (w > 64) { h = h * 64 / w; w = 64; }
          const im = document.createElement('img'); im.className = 'op-img'; im.src = opts.logoUrl;
          im.style.left = pcW(op.x); im.style.top = pcH(op.y); im.style.width = pcW(w); im.style.height = pcH(h);
          sheet.appendChild(im);
        }
      } else if (op.t === 'text') {
        const d = el(); d.style.left = pcW(op.x); d.style.top = pcH(op.y - op.size * 0.80);
        d.style.fontFamily = op.font === 'serif' ? "'PT Serif', Georgia, serif" : "'PT Sans', -apple-system, sans-serif";
        d.style.fontSize = (op.size * scale) + 'px'; d.style.lineHeight = '1'; d.style.color = op.color; d.style.whiteSpace = 'nowrap';
        if (op.bold) { d.style.fontWeight = '700'; }
        if (op.spacing) { d.style.letterSpacing = (op.spacing * scale) + 'px'; }
        if (op.align === 'center') { d.style.transform = 'translateX(-50%)'; }
        else if (op.align === 'right') { d.style.transform = 'translateX(-100%)'; }
        d.textContent = op.text == null ? '' : String(op.text);
        sheet.appendChild(d);
      }
    }
    return { pageCount: built.pageCount, page: pageIdx };
  }

  global.Preview = { render, buildPages: (r, c) => buildPages(r, mergeConfig(ReportPDF.DEFAULT_CONFIG, c || {})) };
})(window);

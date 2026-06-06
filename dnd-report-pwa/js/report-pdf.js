/*
 * report-pdf.js — генерация A4-PDF отчёта ДНД целиком в браузере.
 *
 * Это порт оригинального generate_report.py (matplotlib) на pdf-lib.
 * Вся геометрия задаётся в долях страницы (0..1), как в оригинале,
 * затем конвертируется в точки PDF (1/72 дюйма). Кириллица — через
 * встроенный шрифт DejaVu Sans (тот же, что matplotlib использует
 * по умолчанию), поэтому вид совпадает один-в-один.
 *
 * Зависимости (глобалы из vendor/):
 *   PDFLib   — pdf-lib.min.js
 *   fontkit  — fontkit.umd.min.js
 *
 * Экспорт: window.ReportPDF = { generate, DEFAULT_CONFIG, A4 }
 */
(function (global) {
  'use strict';

  // --- A4 в точках (как у matplotlib: 8.27 x 11.69 дюйма) ---
  const A4 = { W: 8.27 * 72, H: 11.69 * 72 }; // 595.44 x 841.68 pt

  // === Дефолтная конфигурация (= ReportConfig из Python) ===
  const DEFAULT_CONFIG = {
    top_margin: 0.015,
    header_height: 0.27,
    small_header_factor: 0.6,
    bottom_margin: 0.03,

    logo_width_fraction: 0.20,
    logo_height_compensation: 0.83,
    logo_bg_colour: '#0B4F37',

    line_height: 0.02,

    org_line1_offset: 0.23,
    station_line_offset: 0.32,
    team_line_offset: 0.22,

    small_lines_start: 0.03,
    small_lines_reserved: 0.20,

    body_gap: 0.02,
    subheading_gap: 0.06,
    list_gap: 0.08,
    signature_min_height: 0.07,
    signature_offset: 0.05,
    signature_line_gap: 0.03,

    content_margin: 0.07,
    sub_indent: 0.02,

    colours: {
      green_dark: '#0B4F37',
      accent_yellow: '#F6C744',
      header_text: '#E8F5E9',
      small_text: '#8FAF98',
      subheader_green: '#007E2B',
      body_text: '#212121',
      red: '#C62828',
    },
  };

  // Размеры шрифтов (= FontSizes)
  const FS = {
    SMALL_HEADER: 7.5,
    ORG_TITLE: 34,
    STATION_TEAM: 13,
    REPORT_TITLE: 24,
    SECTION_HEADING: 18,
    ACTIVITY: 11,
    SIGNATURE: 13,
  };

  const WRAP = { SMALL: 60, ACTIVITY: 80 };
  const DEFAULT_LABELS = {
    reportTitle: 'Отчёт за {month} {year}',
    sectionHeading: 'За {month} {year} проведено:',
    signatureTitle: 'Командир Добровольной Народной Дружины:',
  };
  function applyTpl(s, m, y) { return String(s).replace(/\{month\}/g, m).replace(/\{year\}/g, y); }
  function resolveLabels(report) { return Object.assign({}, DEFAULT_LABELS, report.labels || {}); }

  // --- утилиты ---
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // Перенос по словам ~ как textwrap.wrap(width): жадно, длинные слова режем.
  function wrapText(text, width) {
    const out = [];
    const paragraphs = String(text).split('\n');
    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) { continue; }
      let line = '';
      for (let w of words) {
        // режем слишком длинное слово
        while (w.length > width) {
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, width));
          w = w.slice(width);
        }
        if (!line) {
          line = w;
        } else if (line.length + 1 + w.length <= width) {
          line += ' ' + w;
        } else {
          out.push(line);
          line = w;
        }
      }
      if (line) { out.push(line); }
    }
    return out;
  }

  function prepareOrgTitle(org) {
    const s = String(org).trim();
    const i = s.indexOf(' ');
    return i === -1 ? s : s.slice(0, i) + '\n' + s.slice(i + 1);
  }

  function flattenActivities(activities) {
    const lines = [];
    activities.forEach((act, idx) => {
      const main = wrapText(act.text || '', WRAP.ACTIVITY);
      if (main.length) { main[0] = `${idx + 1}. ` + main[0]; }
      main.forEach((l) => lines.push({ indent: 0, text: l }));
      (act.subitems || []).forEach((sub, sidx) => {
        const sl = wrapText(sub || '', WRAP.ACTIVITY);
        if (sl.length) { sl[0] = `${sidx + 1}) ` + sl[0]; }
        sl.forEach((l) => lines.push({ indent: 1, text: l }));
      });
    });
    return lines;
  }

  // === Генерация ===
  // report: {month, year, organization, station, team_name, commander,
  //          activities:[{text, subitems:[]}], small_lines:[]}
  // opts:   {logoBytes: Uint8Array|null, config: {}}
  async function generate(report, opts) {
    opts = opts || {};
    const cfg = mergeConfig(DEFAULT_CONFIG, opts.config || {});
    const { W, H } = A4;

    const doc = await PDFLib.PDFDocument.create();
    doc.registerFontkit(fontkit);

    let logoImg = null, logoAspect = 1;
    if (opts.logoBytes) {
      try {
        logoImg = await doc.embedPng(opts.logoBytes);
        logoAspect = logoImg.width / logoImg.height;
      } catch (e) {
        try { logoImg = await doc.embedJpg(opts.logoBytes); logoAspect = logoImg.width / logoImg.height; }
        catch (e2) { logoImg = null; }
      }
    }

    // === Стиль «Модерн» — отдельный рендер по общему op-списку ===
    if (cfg.style === 'modern' && global.LayoutModern) {
      const [sr, srb, ss, ssb] = await Promise.all([
        fetchBytes('fonts/PTSerif-Regular.ttf'), fetchBytes('fonts/PTSerif-Bold.ttf'),
        fetchBytes('fonts/PTSans-Regular.ttf'), fetchBytes('fonts/PTSans-Bold.ttf'),
      ]);
      // subset:false — у PT-шрифтов сабсеттер pdf-lib теряет часть кириллических глифов
      const mf = {
        serif: await doc.embedFont(sr), serifB: await doc.embedFont(srb),
        sans: await doc.embedFont(ss), sansB: await doc.embedFont(ssb),
      };
      const built = global.LayoutModern.build(report, cfg);
      const aspect = logoImg ? (logoImg.width / logoImg.height) : 0.7;
      for (const ops of built.pages) {
        const page = doc.addPage([W, H]);
        drawOpsPDF(page, ops, mf, logoImg, W, H, aspect);
      }
      return doc.save();
    }

    const [regBytes, boldBytes] = await Promise.all([
      fetchBytes('fonts/DejaVuSans.ttf'),
      fetchBytes('fonts/DejaVuSans-Bold.ttf'),
    ]);
    const fReg = await doc.embedFont(regBytes, { subset: true });
    const fBold = await doc.embedFont(boldBytes, { subset: true });

    const flat = flattenActivities(report.activities || []);
    const total = flat.length;
    const smallWrapped = [];
    (report.small_lines || []).forEach((l) => wrapText(l, WRAP.SMALL).forEach((x) => smallWrapped.push(x)));
    const orgTitle = prepareOrgTitle(report.organization || '');

    const linesPerPage = calcLinesPerPage(cfg);

    let page = null;
    const labels = resolveLabels(report);
    const ctx = { doc, fReg, fBold, cfg, W, H, labels };

    // helpers ниже захватывают `page`
    const draw = makeDrawers(ctx, () => page);

    let index = 0;
    let pageNo = 0;
    while (index < total || pageNo === 0) {
      pageNo += 1;
      const isFirst = pageNo === 1;
      page = doc.addPage([W, H]);

      const header = headerGeometry(cfg, isFirst);
      draw.commonHeader(header, smallWrapped, orgTitle);

      let listStartY;
      if (isFirst) {
        draw.stationTeam(header, report);
        if (logoImg) { draw.logo(header, logoImg, logoAspect); }
        listStartY = draw.firstTitles(header, report);
      } else {
        listStartY = header.bottom - cfg.body_gap;
      }

      const remaining = total - index;
      const thisPage = Math.min(remaining, linesPerPage);
      let y = listStartY;
      for (let i = 0; i < thisPage; i++) {
        const { indent, text } = flat[index + i];
        const x = cfg.content_margin + cfg.sub_indent * indent;
        draw.text(x, y, text, FS.ACTIVITY, cfg.colours.body_text, false);
        y -= cfg.line_height;
      }
      index += thisPage;

      if (index >= total) {
        // подпись
        if ((y - cfg.signature_min_height) > cfg.bottom_margin) {
          let sigY = Math.max(y - cfg.signature_offset, cfg.bottom_margin + cfg.signature_offset);
          draw.signature(sigY, report.commander);
        } else {
          page = doc.addPage([W, H]);
          const h2 = headerGeometry(cfg, false);
          draw.commonHeader(h2, smallWrapped, orgTitle);
          const sigY = h2.bottom - cfg.body_gap - cfg.signature_offset;
          draw.signature(sigY, report.commander);
        }
      }
    }

    return doc.save();
  }

  // --- геометрия ---
  function headerGeometry(cfg, isFirst) {
    const top = 1.0 - cfg.top_margin;
    const height = isFirst ? cfg.header_height : cfg.header_height * cfg.small_header_factor;
    return { top, bottom: top - height, height };
  }

  function calcLinesPerPage(cfg) {
    const fp = (() => {
      const h = headerGeometry(cfg, true);
      const bodyTop = h.bottom - cfg.body_gap;
      const sub = bodyTop - cfg.subheading_gap;
      const listStart = sub - cfg.list_gap;
      return listStart - cfg.bottom_margin;
    })();
    const sp = (() => {
      const h = headerGeometry(cfg, false);
      return (h.bottom - cfg.body_gap) - cfg.bottom_margin;
    })();
    return Math.max(Math.floor(Math.min(fp, sp) / cfg.line_height), 1);
  }

  // --- рисовалки (доли → точки) ---
  function makeDrawers(ctx, getPage) {
    const { cfg, W, H, fReg, fBold, labels } = ctx;

    function font(bold) { return bold ? fBold : fReg; }

    // va='top': верх текста на yFrac. baseline = top - ascent.
    function text(xFrac, yFracTop, str, sizePt, colourHex, bold) {
      const f = font(bold);
      const ascent = f.heightAtSize(sizePt, { descender: false });
      const lines = String(str).split('\n');
      let cy = yFracTop * H - ascent;
      const lineStep = f.heightAtSize(sizePt) * 1.0;
      for (const ln of lines) {
        getPage().drawText(ln, {
          x: xFrac * W,
          y: cy,
          size: sizePt,
          font: f,
          color: hexToRgb(colourHex),
        });
        cy -= lineStep;
      }
    }

    function rect(xFrac, yFrac, wFrac, hFrac, colourHex) {
      getPage().drawRectangle({
        x: xFrac * W,
        y: yFrac * H,
        width: wFrac * W,
        height: hFrac * H,
        color: hexToRgb(colourHex),
      });
    }

    function commonHeader(header, smallWrapped, orgTitle) {
      rect(0, header.bottom, 1, header.height, cfg.colours.green_dark);
      if (smallWrapped.length) {
        const spacing = cfg.small_lines_reserved / smallWrapped.length;
        smallWrapped.forEach((ln, i) => {
          const y = header.top - (cfg.small_lines_start + i * spacing) * header.height;
          text(cfg.content_margin, y, ln, FS.SMALL_HEADER, cfg.colours.small_text, false);
        });
      }
      const orgY = header.top - cfg.org_line1_offset * header.height;
      text(cfg.content_margin, orgY, orgTitle, FS.ORG_TITLE, cfg.colours.accent_yellow, true);
    }

    function stationTeam(header, report) {
      const sy = header.bottom + cfg.station_line_offset * header.height;
      const ty = header.bottom + cfg.team_line_offset * header.height;
      text(cfg.content_margin, sy, report.station || '', FS.STATION_TEAM, cfg.colours.header_text, false);
      text(cfg.content_margin, ty, report.team_name || '', FS.STATION_TEAM, cfg.colours.header_text, false);
    }

    function logo(header, img, aspect) {
      const adjusted = cfg.logo_height_compensation ? aspect / cfg.logo_height_compensation : aspect;
      const wFrac = cfg.logo_width_fraction;
      const hFrac = wFrac / adjusted;
      const xFrac = 1 - cfg.content_margin - wFrac;
      const yFrac = header.bottom + (header.height - hFrac) / 2;
      // панель за лого
      rect(xFrac, header.bottom, 1 - xFrac, header.height, cfg.logo_bg_colour);
      getPage().drawImage(img, {
        x: xFrac * W,
        y: yFrac * H,
        width: wFrac * W,
        height: hFrac * H,
      });
    }

    function firstTitles(header, report) {
      const bodyTop = header.bottom - cfg.body_gap;
      text(cfg.content_margin, bodyTop, applyTpl(labels.reportTitle, report.month, report.year),
        FS.REPORT_TITLE, cfg.colours.subheader_green, true);
      const subY = bodyTop - cfg.subheading_gap;
      text(cfg.content_margin, subY, applyTpl(labels.sectionHeading, report.month, report.year),
        FS.SECTION_HEADING, cfg.colours.red, true);
      return subY - cfg.list_gap;
    }

    function signature(yFrac, commander) {
      text(cfg.content_margin, yFrac, labels.signatureTitle, FS.SIGNATURE, cfg.colours.body_text, true);
      text(cfg.content_margin, yFrac - cfg.signature_line_gap, commander || '', FS.SIGNATURE, cfg.colours.body_text, false);
    }

    return { text, rect, commonHeader, stationTeam, logo, firstTitles, signature };
  }

  // === Рендер абстрактного op-списка (стиль «Модерн») в pdf-lib ===
  function drawOpsPDF(page, ops, mf, logoImg, W, H, aspect) {
    const fontFor = (op) => op.font === 'serif' ? (op.bold ? mf.serifB : mf.serif) : (op.bold ? mf.sansB : mf.sans);
    for (const op of ops) {
      if (op.t === 'rect') {
        const o = { x: op.x, y: H - op.y - op.h, width: op.w, height: op.h };
        if (op.fill) { o.color = hexToRgb(op.fill); }
        if (op.stroke) { o.borderColor = hexToRgb(op.stroke); o.borderWidth = op.sw || 1; }
        page.drawRectangle(o);
      } else if (op.t === 'line') {
        page.drawLine({ start: { x: op.x1, y: H - op.y1 }, end: { x: op.x2, y: H - op.y2 }, thickness: op.width || 1, color: hexToRgb(op.stroke) });
      } else if (op.t === 'circle') {
        page.drawCircle({ x: op.cx, y: H - op.cy, size: op.r, color: hexToRgb(op.fill) });
      } else if (op.t === 'image') {
        if (logoImg) {
          let h = op.h, w = op.w != null ? op.w : op.h * (aspect || 0.7);
          if (w > 64) { h = h * 64 / w; w = 64; }            // защита от слишком широкого лого
          page.drawImage(logoImg, { x: op.x, y: H - op.y - h, width: w, height: h });
        }
      } else if (op.t === 'text') {
        const f = fontFor(op), size = op.size, text = op.text == null ? '' : String(op.text);
        const y = H - op.y, col = hexToRgb(op.color);
        if (op.spacing) {
          const chars = Array.from(text);
          const widths = chars.map((ch) => f.widthOfTextAtSize(ch, size));
          const total = widths.reduce((a, b) => a + b, 0) + op.spacing * (chars.length - 1);
          let cx = op.x - (op.align === 'center' ? total / 2 : op.align === 'right' ? total : 0);
          chars.forEach((ch, i) => { page.drawText(ch, { x: cx, y, size, font: f, color: col }); cx += widths[i] + op.spacing; });
        } else {
          const w = f.widthOfTextAtSize(text, size);
          const x = op.x - (op.align === 'center' ? w / 2 : op.align === 'right' ? w : 0);
          page.drawText(text, { x, y, size, font: f, color: col });
        }
      }
    }
  }

  function mergeConfig(base, over) {
    const out = JSON.parse(JSON.stringify(base));
    for (const k in over) {
      if (k === 'colours' && over.colours) { Object.assign(out.colours, over.colours); }
      else { out[k] = over[k]; }
    }
    return out;
  }

  async function fetchBytes(url) {
    const r = await fetch(url);
    if (!r.ok) { throw new Error('Не удалось загрузить ' + url); }
    return new Uint8Array(await r.arrayBuffer());
  }

  global.ReportPDF = { generate, DEFAULT_CONFIG, A4, _wrapText: wrapText, _flatten: flattenActivities };
})(window);

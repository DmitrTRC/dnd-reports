/* app.js — контроллер «Отчёты ДНД» с профилями отрядов */
(function () {
  'use strict';

  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  const DEF_LABELS = {
    reportTitle: 'Отчёт за {month} {year}',
    sectionHeading: 'За {month} {year} проведено:',
    signatureTitle: 'Командир Добровольной Народной Дружины:',
  };
  // Почтовые адреса по умолчанию (одинаковы у всех, меняются редко)
  const DEF_EMAIL = () => ({ sender: '9984398@gmail.com', recipients: [{ label: 'ГМТО (МВД)', email: 'baev-gmto@yandex.ru' }] });
  const DEF_CONFIG = () => ({
    style: 'modern',
    colours: JSON.parse(JSON.stringify(ReportPDF.DEFAULT_CONFIG.colours)),
    logo_bg_colour: '#0B4F37',
    logo_width_fraction: 0.20,
    logo_height_compensation: 0.83,
    content_margin: 0.07,
  });
  const COLOR_FIELDS = [
    ['green_dark', 'Цвет шапки'],
    ['accent_yellow', 'Название организации'],
    ['subheader_green', 'Заголовок отчёта'],
    ['red', 'Подзаголовок (красный)'],
    ['header_text', 'Текст в шапке'],
    ['small_text', 'Мелкие строки шапки'],
    ['body_text', 'Текст списка / подпись'],
  ];

  const $ = (id) => document.getElementById(id);
  const els = {};
  ['fMonth', 'fYear', 'acts', 'actsEmpty', 'preview', 'pager', 'history', 'historyEmpty',
    'brandSub', 'brandLogo', 'toast', 'profileSelect',
    'btnSettings', 'btnNew', 'btnImport', 'btnExport', 'btnPdf', 'btnPdf2', 'btnTheme', 'btnAddAct',
    'btnSave', 'btnSend', 'sendTo', 'fileImport', 'btnTemplate', 'btnReset', 'btnSeedHistory',
    'drawer', 'drawerOverlay', 'btnCloseDrawer', 'tabs',
    'sName', 'sOrg', 'sStation', 'sTeam', 'sCommander', 'sSmall', 'sLogoPreview', 'sLogoBg',
    'btnLogo', 'btnLogoReset', 'fileLogo',
    'sStyle', 'colorGrid', 'btnColorsReset',
    'tTitle', 'tHeading', 'tSign', 'btnTextsReset',
    'eSender', 'recips', 'btnAddRecip', 'eEndpoint', 'serverStatus',
    'btnProfExport', 'btnProfImport', 'btnProfDup', 'btnProfDelete', 'fileProfile']
    .forEach((id) => els[id] = $(id));

  const state = {
    settings: null,      // {version:2, activeProfileId, profiles:{}}
    profile: null,       // ссылка на активный профиль
    report: null,        // {month, year, activities}
    currentId: null,
    logoAspect: 1,
    page: 0,
    serverReady: false,
    template: null,      // активности последнего отчёта профиля (образец)
  };

  init();

  // ================= ИНИЦИАЛИЗАЦИЯ =================
  async function init() {
    if (localStorage.getItem('dnd-theme') === 'light') { document.documentElement.classList.add('light'); }
    MONTHS.forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m; els.fMonth.appendChild(o); });

    let s = await Store.getSettings();
    if (!s) { s = await freshSettings(); }
    else if (!s.version) { s = migrateV1(s); }
    Object.values(s.profiles).forEach(ensureProfileDefaults);
    if (!s.profiles[s.activeProfileId]) { s.activeProfileId = Object.keys(s.profiles)[0]; }
    // разовая обрезка прозрачных полей у уже сохранённых эмблем
    for (const p of Object.values(s.profiles)) {
      if (p.logoDataUrl && !p.logoCropped) { p.logoDataUrl = await cropLogo(p.logoDataUrl); p.logoCropped = true; }
    }
    state.settings = s;
    state.profile = s.profiles[s.activeProfileId];
    await Store.saveSettings(s);

    state.report = blankReport();
    await seedHistoryIfNeeded();
    await recomputeTemplate();
    buildColorGrid();
    buildProfileSelect();
    applyProfileToDrawer();
    applyReportToForm();
    bind();
    await refreshLogo();
    renderActs();
    renderHistory();
    buildSendTo();
    syncBrand();
    schedulePreview();
    registerSW();
    els.eEndpoint.value = state.settings.sendEndpoint || '';
    probeServer();
  }

  // ---- доступность сервера отправки ----
  function sendBase() {
    const v = (state.settings.sendEndpoint || '').trim().replace(/\/+$/, '');
    if (v) { return v; }
    if (location.protocol === 'http:' || location.protocol === 'https:') { return location.origin; }
    return null; // file:// — сервера нет
  }
  async function probeServer() {
    state.serverReady = false;
    const base = sendBase();
    if (!base) { setServerStatus(false, 'недоступен (нужен запуск send_server.py)'); return; }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(base + '/api/health', { signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j && j.ok) {
        state.serverReady = true;
        setServerStatus(true, j.configured ? 'подключён — отправка в один клик' : 'запущен, но SMTP не настроен (email_config.json)');
      } else { setServerStatus(false, 'не отвечает'); }
    } catch (e) { setServerStatus(false, 'недоступен — будет фолбэк (Поделиться/почта)'); }
    updateSendButton();
  }
  function setServerStatus(on, text) {
    if (!els.serverStatus) { return; }
    els.serverStatus.textContent = 'Сервер отправки: ' + text;
    els.serverStatus.className = 'muted small ' + (on ? 'server-on' : 'server-off');
  }
  function updateSendButton() {
    if (state.serverReady) { els.btnSend.textContent = '✉ Отправить'; els.btnSend.title = 'Отправить в один клик через сервер'; }
    else { els.btnSend.textContent = '✉ Отправить'; els.btnSend.title = 'Отправить (Поделиться или почтовый клиент)'; }
  }

  // ================= АРХИВ / ИСТОРИЯ из старого проекта =================
  async function seedHistoryIfNeeded() {
    if (state.settings.historySeeded) { return; }
    await importArchive(false);
    state.settings.historySeeded = true;
    await Store.saveSettings(state.settings);
  }
  async function importArchive(force) {
    let manifest;
    try { manifest = await (await fetch('samples/history.json')).json(); }
    catch (e) { return 0; }
    const files = (manifest && manifest.files) || [];
    let n = 0;
    for (const fn of files) {
      try {
        const d = await (await fetch('samples/' + fn)).json();
        const id = 'seed-' + state.profile.id + '-' + fn.replace(/[^\w]/g, '_');
        if (!force && await Store.getReport(id)) { continue; }
        const year = parseInt(d.year, 10) || new Date().getFullYear();
        const idx = MONTHS.indexOf(d.month);
        await Store.saveReport({
          id, profileId: state.profile.id,
          title: `${state.profile.name}: ${d.month} ${year}`,
          month: d.month, year,
          data: { month: d.month, year, activities: (d.activities || []).map((a) => ({ text: a.text || '', subitems: a.subitems || [] })) },
          updated: Date.UTC(year, idx < 0 ? 0 : idx, 1),
        }, true);
        n++;
      } catch (e) { /* пропускаем битый файл */ }
    }
    return n;
  }
  async function onSeedArchive() {
    const n = await importArchive(true);
    state.settings.historySeeded = true; await Store.saveSettings(state.settings);
    await recomputeTemplate(); renderActs(); renderHistory();
    toast(n ? ('Импортировано отчётов: ' + n) : 'Архив не найден');
  }

  // ================= ОБРАЗЕЦ ПРОШЛОГО МЕСЯЦА =================
  async function recomputeTemplate() {
    const all = await Store.listReports();
    const list = all.filter((r) => r.profileId === state.profile.id && r.id !== state.currentId);
    state.template = list.length ? (list[0].data.activities || null) : null;
    if (els.btnTemplate) { els.btnTemplate.hidden = !state.template; }
  }
  async function onResetForm() {
    const hasContent = state.report.activities.some((a) => (a.text || '').trim() || (a.subitems || []).some((s) => (s || '').trim()));
    if (hasContent && !confirm('Очистить все пункты текущего отчёта?')) { return; }
    state.report.activities = [{ text: '', subitems: [] }];
    state.currentId = null;
    await recomputeTemplate(); renderActs(); schedulePreview(); toast('Форма очищена');
  }
  function onApplyTemplate() {
    if (!state.template) { return; }
    const hasContent = state.report.activities.some((a) => (a.text || '').trim() || (a.subitems || []).some((s) => (s || '').trim()));
    if (hasContent && !confirm('Заменить текущие пункты образцом прошлого месяца?')) { return; }
    state.report.activities = JSON.parse(JSON.stringify(state.template));
    renderActs(); schedulePreview(); toast('Заполнено по образцу — отредактируйте и подтвердите');
  }
  function makeSuggest(text, applyFn) {
    const d = document.createElement('div'); d.className = 'suggest';
    const t = document.createElement('div'); t.className = 's-text'; t.innerHTML = '<b>образец:</b> ' + escapeHtml(text);
    t.title = text;
    const b = document.createElement('button'); b.className = 's-apply'; b.title = 'Подставить образец'; b.textContent = '✓';
    b.addEventListener('click', applyFn);
    d.append(t, b); return d;
  }

  function blankReport() {
    const now = new Date();
    return { month: MONTHS[now.getMonth()], year: now.getFullYear(), activities: [{ text: '', subitems: [] }] };
  }

  // ---- дефолты профиля ----
  function ensureProfileDefaults(p) {
    p.config = Object.assign(DEF_CONFIG(), p.config || {});
    p.config.colours = Object.assign(JSON.parse(JSON.stringify(ReportPDF.DEFAULT_CONFIG.colours)), p.config.colours || {});
    p.labels = Object.assign({}, DEF_LABELS, p.labels || {});
    p.email = Object.assign({ sender: '', recipients: [] }, p.email || {});
    if (!Array.isArray(p.email.recipients)) { p.email.recipients = []; }
    // если почта не заполнена — проставляем общие адреса по умолчанию
    if (!p.email.sender && p.email.recipients.length === 0) { p.email = DEF_EMAIL(); }
    if (!p.name) { p.name = p.team_name || p.organization || 'Отряд'; }
    return p;
  }

  function defaultProfile(id, withSeed) {
    const p = {
      id, name: withSeed ? 'Лукоморье' : 'Новый отряд',
      organization: withSeed ? 'ПРАВОПОРЯДОК ЛУКОМОРЬЯ' : '',
      station: withSeed ? 'МО Колтушское городское поселение' : '',
      team_name: 'Добровольная Народная Дружина',
      commander: withSeed ? 'Морозов Дмитрий Вадимович' : '',
      small_lines: withSeed ? [
        'Свидетельство ГУ МВД РФ по Санкт-Петербургу и Ленинградской области №14/1-816  23.03.2018',
        'Ленинградская область, Всеволожский р-н, Канисты д, терр КПП Лукоморье, Лесопарковая ул, дом №5',
      ] : [],
      logoDataUrl: null,
      config: DEF_CONFIG(),
      labels: Object.assign({}, DEF_LABELS),
      email: DEF_EMAIL(),
    };
    return p;
  }

  async function freshSettings() {
    const id = 'p-' + Date.now();
    const p = defaultProfile(id, true);
    try { p.logoDataUrl = await cropLogo(await urlToDataUrl('icons/emblem.png')); p.logoCropped = true; } catch (e) { p.logoDataUrl = null; }
    return { version: 2, activeProfileId: id, profiles: { [id]: p } };
  }

  function migrateV1(old) {
    const id = 'p-' + Date.now();
    const p = ensureProfileDefaults({
      id, name: 'Лукоморье',
      organization: old.organization, station: old.station, team_name: old.team_name,
      commander: old.commander, small_lines: old.small_lines || [],
      logoDataUrl: old.logoDataUrl || null,
      config: Object.assign(DEF_CONFIG(), old.config || {}),
      labels: Object.assign({}, DEF_LABELS),
      email: { sender: '', recipients: [] },
    });
    return { version: 2, activeProfileId: id, profiles: { [id]: p } };
  }

  // ================= ПРОФИЛИ =================
  function buildProfileSelect() {
    const sel = els.profileSelect;
    sel.innerHTML = '';
    Object.values(state.settings.profiles).forEach((p) => {
      const o = document.createElement('option'); o.value = p.id; o.textContent = p.name || 'Без имени';
      sel.appendChild(o);
    });
    const sep = document.createElement('option'); sep.disabled = true; sep.textContent = '──────────'; sel.appendChild(sep);
    const nw = document.createElement('option'); nw.value = '__new__'; nw.textContent = '＋ Новый отряд…'; sel.appendChild(nw);
    sel.value = state.settings.activeProfileId;
  }

  async function onProfileChange() {
    const val = els.profileSelect.value;
    if (val === '__new__') {
      const id = 'p-' + Date.now();
      const p = ensureProfileDefaults(defaultProfile(id, false));
      state.settings.profiles[id] = p;
      state.settings.activeProfileId = id;
      state.profile = p;
      await Store.saveSettings(state.settings);
      buildProfileSelect();
      afterProfileSwitch();
      openDrawer('squad');
      toast('Создан новый отряд — заполните данные');
      return;
    }
    state.settings.activeProfileId = val;
    state.profile = state.settings.profiles[val];
    await Store.saveSettings(state.settings);
    afterProfileSwitch();
    toast('Отряд: ' + (state.profile.name || ''));
  }

  function afterProfileSwitch() {
    state.currentId = null; state.page = 0;
    applyProfileToDrawer();
    refreshLogo();
    buildSendTo();
    syncBrand();
    renderHistory();
    recomputeTemplate().then(() => renderActs());
    renderPreview();
  }

  // ================= DRAWER: заполнение и привязка =================
  function applyProfileToDrawer() {
    const p = state.profile;
    els.sName.value = p.name || '';
    els.sOrg.value = p.organization || '';
    els.sStation.value = p.station || '';
    els.sTeam.value = p.team_name || '';
    els.sCommander.value = p.commander || '';
    els.sSmall.value = (p.small_lines || []).join('\n');
    els.sLogoBg.value = toHex(p.config.logo_bg_colour);
    els.sStyle.value = p.config.style || 'modern';
    els.tTitle.value = p.labels.reportTitle;
    els.tHeading.value = p.labels.sectionHeading;
    els.tSign.value = p.labels.signatureTitle;
    els.eSender.value = p.email.sender || '';
    // цвета
    COLOR_FIELDS.forEach(([key]) => {
      const inp = els.colorGrid.querySelector(`[data-color="${key}"]`);
      const hex = els.colorGrid.querySelector(`[data-hex="${key}"]`);
      if (inp) { inp.value = toHex(p.config.colours[key]); }
      if (hex) { hex.textContent = toHex(p.config.colours[key]); }
    });
    renderRecips();
    if (p.logoDataUrl) { els.sLogoPreview.src = p.logoDataUrl; } else { els.sLogoPreview.removeAttribute('src'); }
  }

  function buildColorGrid() {
    els.colorGrid.innerHTML = '';
    COLOR_FIELDS.forEach(([key, label]) => {
      const row = document.createElement('div'); row.className = 'color-row';
      const inp = document.createElement('input'); inp.type = 'color'; inp.className = 'swatch'; inp.dataset.color = key;
      const lab = document.createElement('span'); lab.className = 'c-label'; lab.textContent = label;
      const hex = document.createElement('span'); hex.className = 'c-hex'; hex.dataset.hex = key;
      inp.addEventListener('input', () => {
        state.profile.config.colours[key] = inp.value;
        hex.textContent = inp.value.toUpperCase();
        saveSettingsSoon(); schedulePreview();
      });
      row.append(inp, lab, hex);
      els.colorGrid.appendChild(row);
    });
  }

  function bindDrawer() {
    const bindText = (el, fn) => el.addEventListener('input', () => { fn(el.value); saveSettingsSoon(); syncBrand(); schedulePreview(); });
    bindText(els.sName, (v) => { state.profile.name = v; const o = els.profileSelect.querySelector(`option[value="${state.profile.id}"]`); if (o) { o.textContent = v || 'Без имени'; } });
    bindText(els.sOrg, (v) => state.profile.organization = v);
    bindText(els.sStation, (v) => state.profile.station = v);
    bindText(els.sTeam, (v) => state.profile.team_name = v);
    bindText(els.sCommander, (v) => state.profile.commander = v);
    els.sSmall.addEventListener('input', () => { state.profile.small_lines = els.sSmall.value.split('\n').map((x) => x.trim()).filter(Boolean); saveSettingsSoon(); schedulePreview(); });
    els.sLogoBg.addEventListener('input', () => { state.profile.config.logo_bg_colour = els.sLogoBg.value; saveSettingsSoon(); schedulePreview(); });
    els.sStyle.addEventListener('change', () => { state.profile.config.style = els.sStyle.value; state.page = 0; saveSettingsSoon(); renderPreview(); });

    bindText(els.tTitle, (v) => state.profile.labels.reportTitle = v || DEF_LABELS.reportTitle);
    bindText(els.tHeading, (v) => state.profile.labels.sectionHeading = v || DEF_LABELS.sectionHeading);
    bindText(els.tSign, (v) => state.profile.labels.signatureTitle = v || DEF_LABELS.signatureTitle);
    els.eSender.addEventListener('input', () => { state.profile.email.sender = els.eSender.value; saveSettingsSoon(); });
    els.eEndpoint.addEventListener('input', () => { state.settings.sendEndpoint = els.eEndpoint.value.trim(); saveSettingsSoon(); });
    els.eEndpoint.addEventListener('change', () => { probeServer(); });

    els.btnColorsReset.addEventListener('click', () => {
      state.profile.config.colours = JSON.parse(JSON.stringify(ReportPDF.DEFAULT_CONFIG.colours));
      state.profile.config.logo_bg_colour = '#0B4F37';
      applyProfileToDrawer(); saveSettingsSoon(); schedulePreview(); toast('Цвета сброшены');
    });
    els.btnTextsReset.addEventListener('click', () => {
      state.profile.labels = Object.assign({}, DEF_LABELS);
      applyProfileToDrawer(); saveSettingsSoon(); schedulePreview(); toast('Тексты сброшены');
    });

    els.btnAddRecip.addEventListener('click', () => { state.profile.email.recipients.push({ label: '', email: '' }); renderRecips(); saveSettingsSoon(); buildSendTo(); });

    // вкладки
    els.tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.tab'); if (!t) { return; }
      els.tabs.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      const name = t.dataset.tab;
      els.drawer.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
    });

    // профиль
    els.btnProfExport.addEventListener('click', onProfileExport);
    els.btnProfImport.addEventListener('click', () => els.fileProfile.click());
    els.fileProfile.addEventListener('change', onProfileImportFile);
    els.btnProfDup.addEventListener('click', onProfileDuplicate);
    els.btnProfDelete.addEventListener('click', onProfileDelete);

    // лого
    els.btnLogo.addEventListener('click', () => els.fileLogo.click());
    els.fileLogo.addEventListener('change', onLogo);
    els.btnLogoReset.addEventListener('click', onLogoReset);
  }

  function renderRecips() {
    els.recips.innerHTML = '';
    (state.profile.email.recipients || []).forEach((r, i) => {
      const li = $('tplRecip').content.firstElementChild.cloneNode(true);
      const lab = li.querySelector('.r-label'); const em = li.querySelector('.r-email');
      lab.value = r.label || ''; em.value = r.email || '';
      lab.addEventListener('input', () => { r.label = lab.value; saveSettingsSoon(); buildSendTo(); });
      em.addEventListener('input', () => { r.email = em.value.trim(); saveSettingsSoon(); buildSendTo(); });
      li.querySelector('.del').addEventListener('click', () => { state.profile.email.recipients.splice(i, 1); renderRecips(); saveSettingsSoon(); buildSendTo(); });
      els.recips.appendChild(li);
    });
  }

  // ================= ОБЩАЯ ПРИВЯЗКА =================
  function bind() {
    els.fMonth.addEventListener('change', () => { state.report.month = els.fMonth.value; schedulePreview(); });
    els.fYear.addEventListener('input', () => { state.report.year = parseInt(els.fYear.value, 10) || new Date().getFullYear(); schedulePreview(); });
    els.btnAddAct.addEventListener('click', () => { state.report.activities.push({ text: '', subitems: [] }); renderActs(); schedulePreview(); });
    els.btnTemplate.addEventListener('click', onApplyTemplate);
    els.btnReset.addEventListener('click', onResetForm);
    els.btnSeedHistory.addEventListener('click', onSeedArchive);
    els.btnNew.addEventListener('click', onNew);
    els.btnSave.addEventListener('click', onSave);
    els.btnExport.addEventListener('click', onExport);
    els.btnImport.addEventListener('click', () => els.fileImport.click());
    els.fileImport.addEventListener('change', onImport);
    els.btnPdf.addEventListener('click', onPdf);
    els.btnPdf2.addEventListener('click', onPdf);
    els.btnSend.addEventListener('click', onSend);
    els.btnTheme.addEventListener('click', toggleTheme);
    els.profileSelect.addEventListener('change', onProfileChange);
    els.btnSettings.addEventListener('click', () => openDrawer());
    els.btnCloseDrawer.addEventListener('click', closeDrawer);
    els.drawerOverlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.drawer.hidden) { closeDrawer(); } });
    bindDrawer();
    window.addEventListener('resize', debounce(() => renderPreview(), 120));
  }

  function openDrawer(tab) {
    els.drawer.hidden = false; els.drawerOverlay.hidden = false;
    requestAnimationFrame(() => { els.drawer.classList.add('show'); els.drawerOverlay.classList.add('show'); });
    if (tab) { const t = els.tabs.querySelector(`.tab[data-tab="${tab}"]`); if (t) { t.click(); } }
  }
  function closeDrawer() {
    els.drawer.classList.remove('show'); els.drawerOverlay.classList.remove('show');
    setTimeout(() => { els.drawer.hidden = true; els.drawerOverlay.hidden = true; }, 220);
  }

  // ================= МЕРОПРИЯТИЯ =================
  function renderActs() {
    const acts = state.report.activities;
    els.acts.innerHTML = '';
    els.actsEmpty.hidden = acts.length > 0;
    acts.forEach((act, ai) => {
      const node = $('tplAct').content.firstElementChild.cloneNode(true);
      node.querySelector('.act-num').textContent = (ai + 1) + '.';
      const ta = node.querySelector('.act-text');
      ta.value = act.text || '';
      ta.addEventListener('input', () => { act.text = ta.value; autoGrow(ta); schedulePreview(); });
      node.querySelector('.up').addEventListener('click', () => move(acts, ai, -1));
      node.querySelector('.down').addEventListener('click', () => move(acts, ai, +1));
      node.querySelector('.del').addEventListener('click', () => { acts.splice(ai, 1); renderActs(); schedulePreview(); });

      // подсказка по образцу для пункта (если поле пустое и есть прошлый отчёт)
      const tplAct = state.template && state.template[ai];
      if (!(act.text || '').trim() && tplAct && tplAct.text) {
        ta.insertAdjacentElement('afterend', makeSuggest(tplAct.text, () => { act.text = tplAct.text; renderActs(); schedulePreview(); }));
      }

      const subsUl = node.querySelector('.subs');
      (act.subitems || []).forEach((sub, si) => {
        subsUl.appendChild(makeSub(act, si));
        const tplSub = tplAct && tplAct.subitems && tplAct.subitems[si];
        if (!(act.subitems[si] || '').trim() && tplSub) {
          const li2 = document.createElement('li'); li2.className = 'sub-suggest';
          li2.appendChild(makeSuggest(tplSub, () => { act.subitems[si] = tplSub; renderActs(); schedulePreview(); }));
          subsUl.appendChild(li2);
        }
      });
      node.querySelector('.add-sub').addEventListener('click', () => { act.subitems = act.subitems || []; act.subitems.push(''); renderActs(); schedulePreview(); });
      els.acts.appendChild(node);
      autoGrow(ta);
    });
  }
  function makeSub(act, si) {
    const li = $('tplSub').content.firstElementChild.cloneNode(true);
    const ta = li.querySelector('.sub-text');
    ta.value = act.subitems[si] || '';
    ta.addEventListener('input', () => { act.subitems[si] = ta.value; autoGrow(ta); schedulePreview(); });
    li.querySelector('.up').addEventListener('click', () => move(act.subitems, si, -1));
    li.querySelector('.down').addEventListener('click', () => move(act.subitems, si, +1));
    li.querySelector('.del').addEventListener('click', () => { act.subitems.splice(si, 1); renderActs(); schedulePreview(); });
    setTimeout(() => autoGrow(ta), 0);
    return li;
  }
  function move(arr, i, dir) { const j = i + dir; if (j < 0 || j >= arr.length) { return; } const t = arr[i]; arr[i] = arr[j]; arr[j] = t; renderActs(); schedulePreview(); }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; }

  // ================= ПРЕВЬЮ =================
  const schedulePreview = debounce(renderPreview, 180);
  function renderPreview() {
    const report = currentReportObject();
    const r = Preview.render(els.preview, report, {
      logoUrl: state.profile.logoDataUrl, logoAspect: state.logoAspect,
      config: state.profile.config, page: state.page,
    });
    renderPager(r.pageCount, r.page);
  }
  function renderPager(count, page) {
    els.pager.innerHTML = '';
    if (count <= 1) { els.pager.textContent = '1 стр.'; return; }
    const prev = button('‹', () => { state.page = Math.max(0, page - 1); renderPreview(); });
    const next = button('›', () => { state.page = Math.min(count - 1, page + 1); renderPreview(); });
    const label = document.createElement('span'); label.textContent = `${page + 1} / ${count}`;
    prev.disabled = page === 0; next.disabled = page === count - 1;
    els.pager.append(prev, label, next);
  }
  function button(txt, fn) { const b = document.createElement('button'); b.className = 'ic'; b.textContent = txt; b.addEventListener('click', fn); return b; }

  function currentReportObject() {
    const p = state.profile;
    const activities = state.report.activities
      .map((a) => ({ text: (a.text || '').trim(), subitems: (a.subitems || []).map((x) => (x || '').trim()).filter(Boolean) }))
      .filter((a) => a.text || a.subitems.length);
    return {
      organization: p.organization, station: p.station, team_name: p.team_name,
      commander: p.commander, small_lines: p.small_lines || [], labels: p.labels,
      month: state.report.month, year: state.report.year, activities,
    };
  }

  function syncBrand() {
    els.brandSub.textContent = state.profile.team_name || 'Добровольная Народная Дружина';
    if (state.profile.logoDataUrl) { els.brandLogo.src = state.profile.logoDataUrl; }
  }

  // ================= ЛОГО =================
  async function refreshLogo() {
    const url = state.profile.logoDataUrl;
    if (url) { els.sLogoPreview.src = url; state.logoAspect = await imgAspect(url).catch(() => 1); }
    else { els.sLogoPreview.removeAttribute('src'); state.logoAspect = 1; }
  }
  async function onLogo(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) { return; }
    state.profile.logoDataUrl = await cropLogo(await fileToDataUrl(file)); state.profile.logoCropped = true;
    await Store.saveSettings(state.settings);
    await refreshLogo(); syncBrand(); renderPreview(); toast('Эмблема обновлена');
  }
  async function onLogoReset() {
    state.profile.logoDataUrl = await cropLogo(await urlToDataUrl('icons/emblem.png')).catch(() => null);
    state.profile.logoCropped = true;
    await Store.saveSettings(state.settings);
    await refreshLogo(); syncBrand(); renderPreview(); toast('Эмблема сброшена');
  }

  // ================= PDF =================
  async function buildPdfBytes() {
    const report = currentReportObject();
    const logoBytes = state.profile.logoDataUrl ? dataUrlToBytes(state.profile.logoDataUrl) : null;
    const bytes = await ReportPDF.generate(report, { logoBytes, config: state.profile.config });
    const name = `${translit(report.month)}_${report.year}_${slug(state.profile.name)}.pdf`;
    return { bytes, name, report };
  }
  async function onPdf() {
    try {
      els.btnPdf.disabled = els.btnPdf2.disabled = true;
      const { bytes, name } = await buildPdfBytes();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
      toast('PDF готов: ' + name);
    } catch (err) { console.error(err); toast('Ошибка PDF: ' + err.message); }
    finally { els.btnPdf.disabled = els.btnPdf2.disabled = false; }
  }

  // ================= ОТПРАВКА =================
  function buildSendTo() {
    const sel = els.sendTo; sel.innerHTML = '';
    const recs = (state.profile.email.recipients || []).filter((r) => r.email);
    if (!recs.length) {
      const o = document.createElement('option'); o.textContent = 'Адресаты не заданы'; o.value = ''; sel.appendChild(o);
      sel.disabled = true; els.btnSend.disabled = true; return;
    }
    recs.forEach((r) => { const o = document.createElement('option'); o.value = r.email; o.textContent = (r.label ? r.label + ' — ' : '') + r.email; sel.appendChild(o); });
    sel.disabled = false; els.btnSend.disabled = false;
  }

  async function onSend() {
    const to = els.sendTo.value;
    if (!to) { toast('Добавьте адресата в настройках (Почта)'); openDrawer('email'); return; }
    let pdf;
    try { els.btnSend.disabled = true; pdf = await buildPdfBytes(); }
    catch (err) { toast('Ошибка PDF: ' + err.message); els.btnSend.disabled = false; return; }

    const subject = `Отчёт ДНД «${state.profile.name}» за ${pdf.report.month} ${pdf.report.year}`;
    const body = `Здравствуйте!\n\nНаправляю ежемесячный отчёт Добровольной Народной Дружины «${state.profile.name}» за ${pdf.report.month} ${pdf.report.year}.\nФайл отчёта во вложении.\n\n${state.profile.commander || ''}${state.profile.email.sender ? '\n' + state.profile.email.sender : ''}`;

    // 1) Отправка в один клик через сервер
    if (state.serverReady) {
      try {
        const r = await fetch(sendBase() + '/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, subject, body, filename: pdf.name, pdf_base64: bytesToBase64(pdf.bytes) }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.ok) { toast('Отправлено: ' + to); els.btnSend.disabled = false; return; }
        toast('Сервер: ' + (j.error || ('код ' + r.status)) + ' — фолбэк');
      } catch (e) {
        state.serverReady = false; setServerStatus(false, 'недоступен — фолбэк');
        toast('Сервер недоступен — фолбэк');
      }
    }
    els.btnSend.disabled = false;

    // 2) Фолбэк: Web Share с вложением (телефоны, Safari)
    const file = new File([pdf.bytes], pdf.name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: subject, text: body }); toast('Отправка через приложение…'); return; }
      catch (e) { if (e && e.name === 'AbortError') { return; } }
    }
    // 3) Фолбэк: скачиваем PDF + открываем почтовый клиент
    downloadBlob(new Blob([pdf.bytes], { type: 'application/pdf' }), pdf.name);
    const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + '\n\n(PDF «' + pdf.name + '» скачан — прикрепите его к письму)')}`;
    window.location.href = mailto;
    toast('Письмо открыто — прикрепите скачанный PDF');
  }

  // ================= ИСТОРИЯ (по отряду) =================
  async function onSave() {
    const report = currentReportObject();
    const id = state.currentId || ('r-' + Date.now());
    await Store.saveReport({
      id, profileId: state.profile.id,
      title: `${state.profile.name}: ${report.month} ${report.year}`,
      month: report.month, year: report.year,
      data: { month: report.month, year: report.year, activities: report.activities },
    });
    state.currentId = id; renderHistory(); await recomputeTemplate(); renderActs(); toast('Сохранено в историю');
  }
  async function renderHistory() {
    const all = await Store.listReports();
    const list = all.filter((r) => r.profileId === state.profile.id);
    els.history.innerHTML = '';
    els.historyEmpty.hidden = list.length > 0;
    list.forEach((rec) => {
      const li = document.createElement('li');
      const main = document.createElement('div'); main.className = 'h-main';
      main.innerHTML = `<div class="h-title">${escapeHtml(rec.month + ' ' + rec.year)}</div><div class="h-date">${fmtDate(rec.updated)}</div>`;
      main.addEventListener('click', () => loadReport(rec.id));
      const del = button('✕', async () => { if (confirm('Удалить отчёт из истории?')) { await Store.deleteReport(rec.id); if (state.currentId === rec.id) { state.currentId = null; } renderHistory(); } });
      del.classList.add('danger');
      li.append(main, del); els.history.appendChild(li);
    });
  }
  async function loadReport(id) {
    const rec = await Store.getReport(id); if (!rec) { return; }
    state.report = { month: rec.data.month, year: rec.data.year, activities: deepCopy(rec.data.activities) };
    state.currentId = id; state.page = 0;
    applyReportToForm(); await recomputeTemplate(); renderActs(); renderPreview(); toast('Отчёт загружен');
  }
  async function onNew() {
    state.report = blankReport(); state.currentId = null; state.page = 0;
    applyReportToForm(); await recomputeTemplate(); renderActs(); renderPreview(); toast('Новый отчёт');
  }
  function applyReportToForm() { els.fMonth.value = state.report.month; els.fYear.value = state.report.year; }

  // ================= ИМПОРТ/ЭКСПОРТ месячного JSON =================
  function onExport() {
    const report = currentReportObject();
    const out = { month: report.month, year: report.year, activities: report.activities };
    downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), `${translit(report.month)}_${report.year}_report.json`);
    toast('JSON выгружен');
  }
  async function onImport(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) { return; }
    try {
      const data = JSON.parse(await file.text());
      if (data.month) { state.report.month = data.month; }
      if (data.year) { state.report.year = parseInt(data.year, 10); }
      if (Array.isArray(data.activities)) { state.report.activities = data.activities.map((a) => ({ text: a.text || '', subitems: a.subitems || [] })); }
      // если в файле есть постоянные поля — обновим активный профиль
      let touched = false;
      ['organization', 'station', 'team_name', 'commander', 'small_lines'].forEach((k) => { if (data[k] !== undefined) { state.profile[k] = data[k]; touched = true; } });
      if (touched) { await Store.saveSettings(state.settings); applyProfileToDrawer(); syncBrand(); }
      state.currentId = null; state.page = 0;
      applyReportToForm(); renderActs(); renderPreview(); toast('Импортировано: ' + file.name);
    } catch (err) { toast('Не удалось прочитать JSON: ' + err.message); }
  }

  // ================= ЭКСПОРТ/ИМПОРТ ПРОФИЛЯ =================
  function onProfileExport() {
    const p = state.profile;
    const blob = new Blob([JSON.stringify({ _type: 'dnd-profile', version: 2, profile: p }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `profile_${slug(p.name)}.json`);
    toast('Профиль выгружен');
  }
  async function onProfileImportFile(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) { return; }
    try {
      const data = JSON.parse(await file.text());
      const incoming = data.profile || data; // допускаем «голый» профиль
      const id = 'p-' + Date.now();
      const p = ensureProfileDefaults(Object.assign({}, incoming, { id }));
      if (!p.name) { p.name = 'Импортированный отряд'; }
      if (p.logoDataUrl) { p.logoDataUrl = await cropLogo(p.logoDataUrl); p.logoCropped = true; }
      state.settings.profiles[id] = p;
      state.settings.activeProfileId = id; state.profile = p;
      await Store.saveSettings(state.settings);
      buildProfileSelect(); afterProfileSwitch(); toast('Профиль импортирован: ' + (p.name || ''));
    } catch (err) { toast('Не удалось прочитать профиль: ' + err.message); }
  }
  async function onProfileDuplicate() {
    const id = 'p-' + Date.now();
    const p = ensureProfileDefaults(Object.assign(JSON.parse(JSON.stringify(state.profile)), { id, name: (state.profile.name || 'Отряд') + ' (копия)' }));
    state.settings.profiles[id] = p; state.settings.activeProfileId = id; state.profile = p;
    await Store.saveSettings(state.settings);
    buildProfileSelect(); afterProfileSwitch(); toast('Отряд продублирован');
  }
  async function onProfileDelete() {
    const ids = Object.keys(state.settings.profiles);
    if (ids.length <= 1) { toast('Нельзя удалить единственный отряд'); return; }
    if (!confirm(`Удалить отряд «${state.profile.name}» вместе с его настройками?`)) { return; }
    delete state.settings.profiles[state.profile.id];
    state.settings.activeProfileId = Object.keys(state.settings.profiles)[0];
    state.profile = state.settings.profiles[state.settings.activeProfileId];
    await Store.saveSettings(state.settings);
    buildProfileSelect(); afterProfileSwitch(); toast('Отряд удалён');
  }

  // ================= ТЕМА =================
  function toggleTheme() {
    const root = document.documentElement; root.classList.toggle('light');
    localStorage.setItem('dnd-theme', root.classList.contains('light') ? 'light' : 'dark');
    renderPreview();
  }

  // ================= УТИЛИТЫ =================
  let settingsTimer = null;
  function saveSettingsSoon() { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => Store.saveSettings(state.settings), 350); }
  function debounce(fn, ms) { let t; return function () { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); }; }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function toast(msg) { els.toast.textContent = msg; els.toast.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => els.toast.classList.remove('show'), 2600); }
  function fmtDate(ts) { if (!ts) { return ''; } const d = new Date(ts); return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
  function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000); }
  function fileToDataUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
  async function urlToDataUrl(url) { const b = await (await fetch(url)).blob(); return fileToDataUrl(b); }
  function dataUrlToBytes(d) { const b = atob(d.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) { a[i] = b.charCodeAt(i); } return a; }
  function bytesToBase64(bytes) { let bin = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) { bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); } return btoa(bin); }
  function imgAspect(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im.naturalWidth / im.naturalHeight); im.onerror = rej; im.src = url; }); }
  // обрезаем прозрачные поля PNG, чтобы щит занимал всю свою область
  function cropLogo(dataUrl) {
    return new Promise((res) => {
      if (!dataUrl) { res(dataUrl); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth, Hh = img.naturalHeight;
          const c = document.createElement('canvas'); c.width = W; c.height = Hh;
          const ctx = c.getContext('2d'); if (!ctx) { res(dataUrl); return; }
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, W, Hh).data;
          let minX = W, minY = Hh, maxX = -1, maxY = -1;
          for (let y = 0; y < Hh; y++) {
            for (let x = 0; x < W; x++) {
              if (data[(y * W + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
            }
          }
          if (maxX < minX) { res(dataUrl); return; }
          const w = maxX - minX + 1, h = maxY - minY + 1;
          const o = document.createElement('canvas'); o.width = w; o.height = h;
          o.getContext('2d').drawImage(c, minX, minY, w, h, 0, 0, w, h);
          res(o.toDataURL('image/png'));
        } catch (e) { res(dataUrl); }
      };
      img.onerror = () => res(dataUrl);
      img.src = dataUrl;
    });
  }
  function toHex(c) { if (!c) { return '#000000'; } if (c[0] === '#' && c.length === 7) { return c.toUpperCase(); } if (c[0] === '#' && c.length === 4) { return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toUpperCase(); } return c; }
  function slug(s) { return String(s || 'otryad').trim().replace(/[^\wа-яёА-ЯЁ]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'otryad'; }
  const TR = { 'Январь': 'january', 'Февраль': 'february', 'Март': 'march', 'Апрель': 'april', 'Май': 'may', 'Июнь': 'june', 'Июль': 'july', 'Август': 'august', 'Сентябрь': 'september', 'Октябрь': 'october', 'Ноябрь': 'november', 'Декабрь': 'december' };
  function translit(m) { return TR[m] || 'report'; }
  function registerSW() { if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e)); } }
})();

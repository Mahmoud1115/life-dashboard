(function () {
  'use strict';

  var DEFAULTS = Object.freeze({
    startTime: '08:00',
    shiftLengthHours: 12,
    onDays: 2,
    offDays: 2
  });
  var state = {
    anchor: '',
    overrides: Object.create(null),
    visibleYear: 0,
    visibleMonth: 0,
    selectedDate: ''
  };

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function dateKey(year, month, day) {
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function parseDateKey(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    var parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) return null;
    return parts;
  }

  // Integer Gregorian day number. This keeps rotation math independent of
  // time zones, DST, ISO strings, and elapsed clock hours.
  function civilDayNumber(parts) {
    var year = parts.year - (parts.month <= 2 ? 1 : 0);
    var era = Math.floor(year / 400);
    var yearOfEra = year - era * 400;
    var adjustedMonth = parts.month + (parts.month > 2 ? -3 : 9);
    var dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + parts.day - 1;
    var dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
    return era * 146097 + dayOfEra;
  }

  function patternStatus(anchorKey, targetKey) {
    var anchor = parseDateKey(anchorKey);
    var target = parseDateKey(targetKey);
    if (!anchor || !target) return null;
    var cycleLength = DEFAULTS.onDays + DEFAULTS.offDays;
    var offset = civilDayNumber(target) - civilDayNumber(anchor);
    var cycleDay = ((offset % cycleLength) + cycleLength) % cycleLength;
    return cycleDay < DEFAULTS.onDays ? 'ON' : 'OFF';
  }

  function statusForDate(anchorKey, targetKey, overrides) {
    var source = overrides || {};
    if (Object.prototype.hasOwnProperty.call(source, targetKey)) {
      var override = source[targetKey];
      if (override === 'ON' || override === 'OFF' || override === 'EXTRA') return override;
    }
    return patternStatus(anchorKey, targetKey);
  }

  function summarizeMonth(year, monthIndex, anchorKey, overrides) {
    var result = { onDays: 0, extraDays: 0, offDays: 0, totalHours: 0 };
    var count = daysInMonth(year, monthIndex + 1);
    for (var day = 1; day <= count; day += 1) {
      var status = statusForDate(anchorKey, dateKey(year, monthIndex + 1, day), overrides);
      if (status === 'ON') result.onDays += 1;
      else if (status === 'EXTRA') result.extraDays += 1;
      else if (status === 'OFF') result.offDays += 1;
    }
    result.totalHours = (result.onDays + result.extraDays) * DEFAULTS.shiftLengthHours;
    return result;
  }

  function addDays(key, amount) {
    var parts = parseDateKey(key);
    if (!parts) return '';
    var local = new Date(parts.year, parts.month - 1, parts.day + amount);
    return dateKey(local.getFullYear(), local.getMonth() + 1, local.getDate());
  }

  function todayKey() {
    var now = new Date();
    return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  function formatMonth(year, monthIndex) {
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
      .format(new Date(year, monthIndex, 1));
  }

  function formatLongDate(key) {
    var parts = parseDateKey(key);
    if (!parts) return '';
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(parts.year, parts.month - 1, parts.day));
  }

  function nextShiftStart(fromKey) {
    var now = new Date();
    var todayStatus = statusForDate(state.anchor, fromKey, state.overrides);
    if (todayStatus === 'ON' || todayStatus === 'EXTRA') {
      var todayParts = parseDateKey(fromKey);
      var startHour = Number(DEFAULTS.startTime.slice(0, 2));
      var start = new Date(todayParts.year, todayParts.month - 1, todayParts.day, startHour, 0, 0, 0);
      var end = new Date(start.getTime() + DEFAULTS.shiftLengthHours * 60 * 60 * 1000);
      if (now >= start && now < end) {
        var endTime = pad2(end.getHours()) + ':' + pad2(end.getMinutes());
        return 'In progress, ends ' + endTime;
      }
    }
    for (var offset = 0; offset <= 370; offset += 1) {
      var key = addDays(fromKey, offset);
      var status = statusForDate(state.anchor, key, state.overrides);
      if (status === 'ON' || status === 'EXTRA') {
        var parts = parseDateKey(key);
        var candidate = new Date(parts.year, parts.month - 1, parts.day, Number(DEFAULTS.startTime.slice(0, 2)), 0, 0, 0);
        if (candidate > now) return formatLongDate(key) + ' · ' + DEFAULTS.startTime;
      }
    }
    return '—';
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function renderSummary() {
    var summary = summarizeMonth(state.visibleYear, state.visibleMonth, state.anchor, state.overrides);
    setText('shift-summary-on', summary.onDays);
    setText('shift-summary-extra', summary.extraDays);
    setText('shift-summary-off', summary.offDays);
    setText('shift-summary-hours', summary.totalHours + ' h');
    setText('shift-next-start', nextShiftStart(todayKey()));
  }

  function renderEditor() {
    var editor = document.getElementById('shift-day-editor');
    if (!editor) return;
    editor.hidden = !state.selectedDate;
    if (!state.selectedDate) return;
    var hasOverride = Object.prototype.hasOwnProperty.call(state.overrides, state.selectedDate);
    var status = statusForDate(state.anchor, state.selectedDate, state.overrides);
    setText('shift-selected-date', formatLongDate(state.selectedDate));
    setText('shift-selected-source', hasOverride ? 'Manual override · ' + status : 'Rotation · ' + status);
    document.querySelectorAll('[data-shift-status]').forEach(function (button) {
      var active = button.dataset.shiftStatus === status && hasOverride;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function makeDayButton(day) {
    var key = dateKey(state.visibleYear, state.visibleMonth + 1, day);
    var status = statusForDate(state.anchor, key, state.overrides);
    var hasOverride = Object.prototype.hasOwnProperty.call(state.overrides, key);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'shift-p1-day is-' + status.toLowerCase();
    if (key === todayKey()) button.classList.add('is-today');
    if (key === state.selectedDate) button.classList.add('is-selected');
    if (hasOverride) button.classList.add('is-override');
    button.dataset.date = key;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', formatLongDate(key) + ', ' + status + (hasOverride ? ', manual override' : ''));

    var number = document.createElement('span');
    number.className = 'shift-p1-day-number';
    number.textContent = String(day);
    var label = document.createElement('strong');
    label.textContent = status;
    button.append(number, label);
    button.addEventListener('click', function () {
      state.selectedDate = key;
      renderCalendar();
      renderEditor();
    });
    return button;
  }

  function renderCalendar() {
    var grid = document.getElementById('shift-calendar-grid');
    if (!grid || !state.anchor) return;
    grid.replaceChildren();
    setText('shift-month-title', formatMonth(state.visibleYear, state.visibleMonth));
    var firstWeekday = new Date(state.visibleYear, state.visibleMonth, 1).getDay();
    var mondayOffset = (firstWeekday + 6) % 7;
    for (var blank = 0; blank < mondayOffset; blank += 1) {
      var spacer = document.createElement('span');
      spacer.className = 'shift-p1-blank';
      spacer.setAttribute('aria-hidden', 'true');
      grid.appendChild(spacer);
    }
    var count = daysInMonth(state.visibleYear, state.visibleMonth + 1);
    for (var day = 1; day <= count; day += 1) grid.appendChild(makeDayButton(day));
    renderSummary();
  }

  function setAnchor(value) {
    var parts = parseDateKey(value);
    if (!parts) {
      state.anchor = '';
      state.overrides = Object.create(null);
      state.selectedDate = '';
      var clearedGrid = document.getElementById('shift-calendar-grid');
      var clearedEmpty = document.getElementById('shift-empty');
      var clearedWorkspace = document.getElementById('shift-workspace');
      if (clearedGrid) clearedGrid.replaceChildren();
      if (clearedEmpty) clearedEmpty.hidden = false;
      if (clearedWorkspace) clearedWorkspace.hidden = true;
      return;
    }
    state.anchor = value;
    state.overrides = Object.create(null);
    state.visibleYear = parts.year;
    state.visibleMonth = parts.month - 1;
    state.selectedDate = value;
    var empty = document.getElementById('shift-empty');
    var workspace = document.getElementById('shift-workspace');
    if (empty) empty.hidden = true;
    if (workspace) workspace.hidden = false;
    renderCalendar();
    renderEditor();
  }

  function moveMonth(amount) {
    var next = new Date(state.visibleYear, state.visibleMonth + amount, 1);
    state.visibleYear = next.getFullYear();
    state.visibleMonth = next.getMonth();
    renderCalendar();
  }

  function setSelectedStatus(status) {
    if (!state.selectedDate || !/^(ON|OFF|EXTRA)$/.test(status)) return;
    state.overrides[state.selectedDate] = status;
    renderCalendar();
    renderEditor();
  }

  function usePattern() {
    if (!state.selectedDate) return;
    delete state.overrides[state.selectedDate];
    renderCalendar();
    renderEditor();
  }

  function open() {
    document.querySelectorAll('.sec').forEach(function (section) { section.classList.remove('active'); });
    var section = document.getElementById('shifts');
    if (section) section.classList.add('active');
    document.querySelectorAll('.nmb').forEach(function (button) {
      button.classList.remove('active');
      button.removeAttribute('aria-current');
    });
    var navButton = document.querySelector('.nmb[data-group="shifts"]');
    if (navButton) {
      navButton.classList.add('active');
      navButton.setAttribute('aria-current', 'page');
    }
    var subnav = document.getElementById('nav-sub');
    if (subnav) {
      subnav.replaceChildren();
      subnav.dataset.group = 'shifts';
    }
    document.querySelectorAll('.mob-nb').forEach(function (button) { button.classList.remove('active'); });
  }

  function init() {
    var now = new Date();
    state.visibleYear = now.getFullYear();
    state.visibleMonth = now.getMonth();
    var anchor = document.getElementById('shift-anchor');
    if (anchor) anchor.addEventListener('input', function () { setAnchor(anchor.value); });
    var previous = document.getElementById('shift-prev-month');
    var next = document.getElementById('shift-next-month');
    if (previous) previous.addEventListener('click', function () { moveMonth(-1); });
    if (next) next.addEventListener('click', function () { moveMonth(1); });
    document.querySelectorAll('[data-shift-status]').forEach(function (button) {
      button.addEventListener('click', function () { setSelectedStatus(button.dataset.shiftStatus); });
    });
    var pattern = document.getElementById('shift-use-pattern');
    if (pattern) pattern.addEventListener('click', usePattern);
  }

  window.ShiftCalendar = Object.freeze({
    DEFAULTS: DEFAULTS,
    statusForDate: statusForDate,
    summarizeMonth: summarizeMonth,
    open: open
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());

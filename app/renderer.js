// ========== Storage Keys ==========
const STORAGE_KEYS = {
  tasks: 'tf21_tasks',
  runningTaskIds: 'tf21_running_v2',
  settings: 'tf21_settings_v2',
  calendar: 'tf21_calendar_v2',
  migrated: 'tf21_migrated_v2',
  todayMode: 'tf21_today_mode'  // {modeType, workStart, workEnd, date}
};

// ========== App State ==========
let appData = loadData();
let lastTickTime = null;
let calendarViewYear, calendarViewMonth;
let editTaskId = null;
let pickerState = { hours: 1, minutes: 0, mode: 'picker' };
let editPickerState = { preset: { hours: 0, minutes: 0 }, used: { hours: 0, minutes: 0 } };
let statsInitialized = false;
let currentTaskTab = 'running'; // 'running' | 'pending'
let endTimeDialogData = null; // { type: 'overtime' | 'efficiency', currentEnd: '' }
let extendTimeEndSec = 0; // for extend time modal calculation
let endTimeExtendPending = false; // true while user is extending time (prevents re-popup)
let _endTimeAlreadyPast = false; // true when app loaded after end time — suppress dialog until user extends
let _endTimeCheckInterval = null;

function loadData() {
  try {
    const tasks = JSON.parse(localStorage.getItem(STORAGE_KEYS.tasks) || '[]');
    const rawRunningIds = localStorage.getItem(STORAGE_KEYS.runningTaskIds);
    const runningTaskIds = (!rawRunningIds || rawRunningIds === '__null__') ? [] : JSON.parse(rawRunningIds);
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || 'null');
    const calendar = JSON.parse(localStorage.getItem(STORAGE_KEYS.calendar) || '{}');
    const todayMode = JSON.parse(localStorage.getItem(STORAGE_KEYS.todayMode) || 'null');
    const multiTaskEnabled = localStorage.getItem('tf21_multitask') === 'true';
    return { tasks, runningTaskIds, settings, calendar, todayMode, multiTaskEnabled };
  } catch(e) {
    return { tasks: [], runningTaskIds: [], settings: null, calendar: {}, todayMode: null, multiTaskEnabled: false };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(appData.tasks));
  localStorage.setItem(STORAGE_KEYS.runningTaskIds,
    appData.runningTaskIds.length === 0 ? '__null__' : JSON.stringify(appData.runningTaskIds));
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(appData.settings));
  localStorage.setItem(STORAGE_KEYS.calendar, JSON.stringify(appData.calendar));
  localStorage.setItem(STORAGE_KEYS.todayMode, JSON.stringify(appData.todayMode));
  localStorage.setItem('tf21_multitask', appData.multiTaskEnabled ? 'true' : 'false');
}

function ensureDemoData() {
  // Already has real data → skip
  if (Object.keys(appData.calendar).length > 0) return;

  // 1. Try to migrate from v2.0 localStorage (same app data dir)
  const v2calendar = localStorage.getItem('tf_calendar_v2');
  if (v2calendar) {
    try {
      const v2data = JSON.parse(v2calendar);
      Object.keys(v2data).forEach(dateStr => {
        const day = v2data[dateStr];
        if (!day || !day.tasks) return;
        // Add description field to each task (v2.0 didn't have it)
        Object.keys(day.tasks).forEach(tid => {
          if (!day.tasks[tid].description) day.tasks[tid].description = '';
        });
        // Default modeType for v2.0 data
        if (!day.modeType) day.modeType = 'overtime';
        appData.calendar[dateStr] = day;
      });
      localStorage.setItem('tf21_migrated_v2', 'true');
      saveData();
      return;
    } catch(e) { /* fall through to embedded data */ }
  }

  // 2. Inject embedded v2.0 historical data (from Time flies DMG)
  const v2embedded = {"2026-07-29":{"tasks":{"task_1785290848252_is1557":{"name":"personal（r）","usedSeconds":4734,"overtimeSeconds":534,"description":""},"task_1785290904534_gc3znq":{"name":"work","usedSeconds":2791,"overtimeSeconds":0,"description":""},"task_1785290940429_tyk2dr":{"name":"videcoding","usedSeconds":2937,"overtimeSeconds":237,"description":""}},"totalUsedSeconds":10462,"totalOvertimeSeconds":771,"status":"normal","modeType":"overtime"},"2026-07-30":{"tasks":{"task_1785395833161_r674wh":{"name":"💼Work time","usedSeconds":6518,"overtimeSeconds":0,"description":""},"task_1785395881459_256nvv":{"name":"⚙️Videcoding","usedSeconds":7962,"overtimeSeconds":762,"description":""},"task_1785395923750_w5t98o":{"name":"👤Personal","usedSeconds":2893,"overtimeSeconds":0,"description":""},"task_1785395970619_4cydm7":{"name":"🥤GAP time","usedSeconds":3044,"overtimeSeconds":0,"description":""},"task_1785396353852_cdb6no":{"name":"💬chat time","usedSeconds":2998,"overtimeSeconds":0,"description":""}},"totalUsedSeconds":23415,"totalOvertimeSeconds":762,"unallocatedSeconds":7185,"status":"early_end","modeType":"overtime"},"2026-07-31":{"tasks":{"task_1785395833161_r674wh":{"name":"💼Work time","usedSeconds":14240,"overtimeSeconds":5240,"description":""},"task_1785395881459_256nvv":{"name":"⚙️Videcoding","usedSeconds":7317,"overtimeSeconds":117,"description":""},"task_1785395923750_w5t98o":{"name":"👤Personal","usedSeconds":0,"overtimeSeconds":0,"description":""},"task_1785395970619_4cydm7":{"name":"🥤GAP time","usedSeconds":2154,"overtimeSeconds":0,"description":""},"task_1785396353852_cdb6no":{"name":"💬chat time","usedSeconds":2950,"overtimeSeconds":0,"description":""},"task_1785471284860_ti1a9j":{"name":"😴sleep time","usedSeconds":3745,"overtimeSeconds":145,"description":""}},"totalUsedSeconds":30406,"totalOvertimeSeconds":5502,"unallocatedSeconds":1994,"status":"early_end","modeType":"overtime"}};
  Object.keys(v2embedded).forEach(dateStr => {
    appData.calendar[dateStr] = v2embedded[dateStr];
  });
  saveData();
}

// ========== Time Utils ==========
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(sec) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatShort(sec) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  if (h>0) return `${h}h${m}m`;
  return `${m}min`;
}

function parseHHMM(str) {
  if (!str) return { h: 9, m: 0 };
  const p = str.split(':');
  return { h: parseInt(p[0])||9, m: parseInt(p[1])||0 };
}

function timeToSeconds(str) {
  const p = parseHHMM(str);
  return p.h * 3600 + p.m * 60;
}

function secondsToHHMM(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// ========== Welcome Page ==========
function welcomeBegin() {
  document.getElementById('welcomePage').classList.remove('active');
  document.getElementById('modePage').classList.add('active');
  resetModeSelection();
}

function modeGoBack() {
  document.getElementById('modePage').classList.remove('active');
  document.getElementById('welcomePage').classList.add('active');
}

// ========== Mode Selection ==========
let selectedModeType = null;

function selectMode(type) {
  selectedModeType = type;
  document.getElementById('modeCardOvertime').classList.toggle('mode-card--selected', type === 'overtime');
  document.getElementById('modeCardEfficiency').classList.toggle('mode-card--selected', type === 'efficiency');

  const ts = document.getElementById('modeTimeSettings');
  ts.style.display = 'block';

  // Update labels
  if (type === 'overtime') {
    document.getElementById('modeStartLabel').textContent = '上班时间';
    document.getElementById('modeEndLabel').textContent = '下班时间';
  } else {
    document.getElementById('modeStartLabel').textContent = '贤者开始时间';
    document.getElementById('modeEndLabel').textContent = '贤者结束时间';
  }

  // Initialize selects
  initModeTimeSelects();
  updateModePool();
  document.getElementById('modeConfirmBtn').style.display = 'block';
}

function resetModeSelection() {
  selectedModeType = null;
  document.getElementById('modeCardOvertime').classList.remove('mode-card--selected');
  document.getElementById('modeCardEfficiency').classList.remove('mode-card--selected');
  document.getElementById('modeTimeSettings').style.display = 'none';
  document.getElementById('modeConfirmBtn').style.display = 'none';
  document.getElementById('modeTimeError').style.display = 'none';
}

function initModeTimeSelects() {
  ['modeStartHour','modeStartMin','modeEndHour','modeEndMin'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isMin = id.includes('Min');
    el.innerHTML = '';
    for (let i = 0; i < (isMin ? 60 : 24); i += (isMin ? 5 : 1)) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = String(i).padStart(2, '0');
      el.appendChild(o);
    }
  });

  // Defaults based on current clock time
  const now = new Date();
  document.getElementById('modeStartHour').value = now.getHours();
  document.getElementById('modeStartMin').value = Math.floor(now.getMinutes() / 5) * 5;
  document.getElementById('modeEndHour').value = 18;
  document.getElementById('modeEndMin').value = 0;

  // Add change listeners
  ['modeStartHour','modeStartMin','modeEndHour','modeEndMin'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateModePool);
  });
}

function updateModePool() {
  const sh = parseInt(document.getElementById('modeStartHour').value);
  const sm = parseInt(document.getElementById('modeStartMin').value);
  const eh = parseInt(document.getElementById('modeEndHour').value);
  const em = parseInt(document.getElementById('modeEndMin').value);

  const startSec = sh * 3600 + sm * 60;
  const endSec = eh * 3600 + em * 60;
  const pool = endSec - startSec;
  const err = document.getElementById('modeTimeError');

  if (pool <= 0) {
    err.style.display = 'block';
    document.getElementById('modeConfirmBtn').disabled = true;
    document.getElementById('modePoolInfo').textContent = '—';
    return;
  }
  err.style.display = 'none';
  document.getElementById('modeConfirmBtn').disabled = false;
  document.getElementById('modePoolInfo').textContent = formatTime(pool);
}

function confirmMode() {
  const sh = parseInt(document.getElementById('modeStartHour').value);
  const sm = parseInt(document.getElementById('modeStartMin').value);
  const eh = parseInt(document.getElementById('modeEndHour').value);
  const em = parseInt(document.getElementById('modeEndMin').value);
  const startSec = sh * 3600 + sm * 60;
  const endSec = eh * 3600 + em * 60;
  const pool = endSec - startSec;

  if (pool <= 0) {
    document.getElementById('modeTimeError').style.display = 'block';
    return;
  }

  appData.settings = {
    modeType: selectedModeType,
    workStart: `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`,
    workEnd: `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`
  };

  appData.todayMode = {
    modeType: selectedModeType,
    workStart: appData.settings.workStart,
    workEnd: appData.settings.workEnd,
    date: getTodayStr()
  };
  appData.poolUsedSeconds = 0;

  // Reset all task timers for a fresh day
  appData.tasks.forEach(t => {
    t.remainingSeconds = t.presetSeconds;
    t.usedSeconds = 0;
    t.overtimeSeconds = 0;
  });

  saveData();

  document.getElementById('modePage').classList.remove('active');
  document.getElementById('appContainer').classList.add('active');
  initApp();
}

// ========== Multi-task Toggle ==========
function toggleMultiTask() {
  appData.multiTaskEnabled = document.getElementById('multiTaskToggle').checked;

  if (!appData.multiTaskEnabled && appData.runningTaskIds.length > 1) {
    // Stop all running tasks
    doTick();
    appData.runningTaskIds = [];
    lastTickTime = null;
    showToast('一心多用已关闭，所有任务已停止');
  }
  saveData();
}

// ========== Status Tabs ==========
function switchTaskTab(tab) {
  currentTaskTab = tab;
  document.querySelectorAll('.status-tab').forEach(t => {
    t.classList.toggle('status-tab--active', t.dataset.tab === tab);
  });
  renderTasks();
}

// ========== Settings ==========
function openSettings() {
  if (!appData.settings) return;
  // IMPORTANT: initialize options BEFORE setting values
  initSettingsSelects();
  const s = parseHHMM(appData.settings.workStart);
  const e = parseHHMM(appData.settings.workEnd);
  document.getElementById('settingsStartHour').value = s.h;
  document.getElementById('settingsStartMin').value = Math.round(s.m / 5) * 5;
  document.getElementById('settingsEndHour').value = e.h;
  document.getElementById('settingsEndMin').value = Math.round(e.m / 5) * 5;
  document.getElementById('settingsStartLabel').textContent =
    appData.settings.modeType === 'efficiency' ? '贤者开始时间' : '上班时间';
  document.getElementById('settingsEndLabel').textContent =
    appData.settings.modeType === 'efficiency' ? '贤者结束时间' : '下班时间';
  document.getElementById('settingsModal').classList.add('active');
}

function initSettingsSelects() {
  ['settingsStartHour','settingsStartMin','settingsEndHour','settingsEndMin'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isMin = id.includes('Min');
    el.innerHTML = '';
    for (let i = 0; i < (isMin ? 60 : 24); i += (isMin ? 5 : 1)) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = String(i).padStart(2, '0');
      el.appendChild(o);
    }
  });
}

function initAllSelects() {
  initSettingsSelects();
  initExtendSelects();
}

function saveSettings() {
  const sh = parseInt(document.getElementById('settingsStartHour').value);
  const sm = parseInt(document.getElementById('settingsStartMin').value);
  const eh = parseInt(document.getElementById('settingsEndHour').value);
  const em = parseInt(document.getElementById('settingsEndMin').value);
  const start = `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;
  const end = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;

  if (sh*60+sm >= eh*60+em) { showToast('结束时间必须晚于开始时间'); return; }

  appData.settings.workStart = start;
  appData.settings.workEnd = end;
  if (appData.todayMode) {
    appData.todayMode.workStart = start;
    appData.todayMode.workEnd = end;
  }
  saveData();
  closeModal('settingsModal');
  showToast('工作设置已更新');
  updateUI();
}

// ========== Timer Core ==========
function getTotalWorkSeconds() {
  if (!appData.settings) return 28800;
  return timeToSeconds(appData.settings.workEnd) - timeToSeconds(appData.settings.workStart);
}

function getClockProgress() {
  if (!appData.settings) return { used: 0, remain: 0, isOvertime: false };
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const startSec = timeToSeconds(appData.settings.workStart);
  const endSec = timeToSeconds(appData.settings.workEnd);
  const totalSec = endSec - startSec;

  if (nowSec <= startSec) {
    return { used: 0, remain: totalSec, isOvertime: false };
  }
  if (nowSec >= endSec) {
    return { used: totalSec, remain: 0, isOvertime: true, overtimeSec: nowSec - endSec };
  }
  return { used: nowSec - startSec, remain: endSec - nowSec, isOvertime: false };
}

function doTick() {
  if (appData.runningTaskIds.length === 0) return;
  if (!lastTickTime) { lastTickTime = Date.now(); return; }

  const now = Date.now();
  const elapsed = Math.floor((now - lastTickTime) / 1000);
  if (elapsed <= 0) return;
  lastTickTime = now;

  // Pool deduction: 1 second per wall-clock second, regardless of how many tasks run
  appData.poolUsedSeconds = (appData.poolUsedSeconds || 0) + elapsed;

  // Each running task deducts its own remainingSeconds
  appData.runningTaskIds.forEach(id => {
    const t = appData.tasks.find(x => x.id === id);
    if (!t) return;
    if (t.remainingSeconds >= elapsed) {
      t.remainingSeconds -= elapsed;
    } else {
      const overflow = elapsed - t.remainingSeconds;
      t.remainingSeconds = 0;
      t.overtimeSeconds += overflow;
    }
    t.usedSeconds += elapsed;
  });
}

function timerTick() {
  // Cross-day detection during runtime
  if (appData.todayMode && appData.todayMode.date !== getTodayStr()) {
    doTick();
    appData.runningTaskIds = [];
    lastTickTime = null;
    settleDay('normal');
    appData.todayMode = null;
    appData.settings = null;
    saveData();
    // Navigate back to welcome page for re-setup
    document.getElementById('appContainer').classList.remove('active');
    document.getElementById('welcomePage').classList.add('active');
    showToast('新的一天，请重新设置工作时间');
    return;
  }

  if (appData.runningTaskIds.length > 0 && lastTickTime && Date.now() - lastTickTime > 3000) {
    doTick();
  }
  doTick();
  if (appData.runningTaskIds.length > 0) {
    updateStatusBar();
    updateRunningCardDisplay();
    updateTimeAxis();
  }
  checkEndTime();
}

function updateRunningCardDisplay() {
  appData.runningTaskIds.forEach(id => {
    const rt = appData.tasks.find(x => x.id === id);
    if (!rt) return;
    const card = document.querySelector(`[data-task-id="${rt.id}"]`);
    if (!card) return;
    const te = card.querySelector('.card-time');
    const oe = card.querySelector('.card-overtime');
    const le = card.querySelector('.card-label');
    if (te) te.textContent = formatTime(rt.remainingSeconds);
    if (oe) oe.textContent = rt.overtimeSeconds > 0 ? `超时 ${formatTime(rt.overtimeSeconds)}` : '';
    if (le) le.textContent = `剩余 / 预设 ${formatTime(rt.presetSeconds)}`;
  });
}

// ========== Task Actions ==========
function startTask(id) {
  const t = appData.tasks.find(x => x.id === id);
  if (!t) return;

  if (appData.runningTaskIds.includes(id)) {
    // Already running → pause
    pauseTask(id);
    return;
  }

  if (!appData.multiTaskEnabled) {
    // Single task mode: stop current task first
    if (appData.runningTaskIds.length > 0) {
      appData.runningTaskIds.forEach(rid => pauseTask(rid));
    }
  }

  // Add to running
  appData.runningTaskIds.push(id);
  if (!lastTickTime) lastTickTime = Date.now();

  saveData();
  renderTasks();
  updateTimeAxis();
  updateStatusBar();
}

function pauseTask(id) {
  if (appData.runningTaskIds.includes(id)) {
    doTick();
    appData.runningTaskIds = appData.runningTaskIds.filter(rid => rid !== id);
    if (appData.runningTaskIds.length === 0) lastTickTime = null;
    saveData();
    renderTasks();
    updateTimeAxis();
    updateStatusBar();
  }
}

function deleteTask(id) {
  // Pause if running
  if (appData.runningTaskIds.includes(id)) {
    appData.runningTaskIds = appData.runningTaskIds.filter(rid => rid !== id);
    if (appData.runningTaskIds.length === 0) lastTickTime = null;
  }
  appData.tasks = appData.tasks.filter(t => t.id !== id);
  appData.tasks.forEach((t,i) => t.order = i);
  saveData();
  renderTasks();
  updateTimeAxis();
  updateStatusBar();
  showToast('任务已删除');
}

function completeTask(id) {
  const t = appData.tasks.find(x => x.id === id);
  if (!t) return;
  // Flush remaining time before completing
  doTick();
  // Remove from running
  if (appData.runningTaskIds.includes(id)) {
    appData.runningTaskIds = appData.runningTaskIds.filter(rid => rid !== id);
    if (appData.runningTaskIds.length === 0) lastTickTime = null;
  }
  t.status = 'completed';
  saveData();
  renderTasks();
  updateTimeAxis();
  updateStatusBar();
  showToast(`「${t.name}」已完成`);
}

function adjustPreset(id, deltaSec) {
  const t = appData.tasks.find(x => x.id === id);
  if (!t) return;
  const newP = Math.max(60, t.presetSeconds + deltaSec);
  const diff = newP - t.presetSeconds;
  t.presetSeconds = newP;
  let newR = t.remainingSeconds + diff;
  if (newR < 0) {
    t.overtimeSeconds += Math.abs(newR);
    t.remainingSeconds = 0;
  } else t.remainingSeconds = newR;
  saveData();
  renderTasks();
  updateTimeAxis();
}

function addTask(name, presetSeconds, desc) {
  const today = getTodayStr();
  const todayTasks = appData.tasks.filter(t => t.dateCreated === today);
  if (todayTasks.length >= 10) { showToast('最多创建 10 个任务'); return false; }
  const id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  appData.tasks.push({
    id, name, presetSeconds,
    remainingSeconds: presetSeconds,
    usedSeconds: 0, overtimeSeconds: 0,
    createdAt: Date.now(), order: appData.tasks.length,
    dateCreated: getTodayStr(),
    description: desc || ''
  });
  saveData();
  renderTasks();
  updateTimeAxis();
  updateStatusBar();
  return true;
}

// ========== Time Axis ==========
function updateTimeAxis() {
  if (!appData.settings) return;
  const totalSec = getTotalWorkSeconds();
  const overtimeSec = appData.tasks.reduce((s,t) => s + t.overtimeSeconds, 0);

  // v2.1.4: 两种模式都使用实时时钟进度
  const cp = getClockProgress();
  const poolUsed = cp.used;
  const remainSec = cp.remain;
  const isOvertime = cp.isOvertime;

  document.getElementById('workHoursLabel').textContent =
    `${appData.settings.workStart} — ${appData.settings.workEnd}`;

  const modeEl = document.getElementById('timeAxisMode');
  if (appData.settings.modeType === 'efficiency') {
    modeEl.textContent = '效率模式';
    modeEl.className = 'time-axis-mode efficiency';
  } else {
    modeEl.textContent = '牛马模式';
    modeEl.className = 'time-axis-mode';
  }

  document.getElementById('usedTimeLabel').textContent = formatTime(poolUsed);
  document.getElementById('remainTimeLabel').textContent = formatTime(remainSec);
  document.getElementById('overtimeAxisLabel').textContent = formatTime(overtimeSec);

  const usedEl = document.getElementById('timeAxisUsed');
  const remainEl = document.getElementById('timeAxisRemaining');

  if (isOvertime) {
    usedEl.style.width = '100%';
    usedEl.classList.add('overtime');
    remainEl.style.width = '0%';
  } else {
    const usedPct = Math.round(poolUsed / totalSec * 100);
    const remainPct = 100 - usedPct;
    usedEl.style.width = `${usedPct}%`;
    usedEl.classList.remove('overtime');
    remainEl.style.width = `${remainPct}%`;
  }
}

// ========== Render Tasks ==========
function renderTasks() {
  const container = document.getElementById('taskList');
  if (!container) return;

  const today = getTodayStr();
  const todayTasks = appData.tasks.filter(t => t.dateCreated === today);

  // Filter by tab
  let filtered;
  if (currentTaskTab === 'running') {
    filtered = todayTasks.filter(t => t.status !== 'completed' && appData.runningTaskIds.includes(t.id));
  } else if (currentTaskTab === 'completed') {
    filtered = todayTasks.filter(t => t.status === 'completed');
  } else {
    filtered = todayTasks.filter(t => t.status !== 'completed' && !appData.runningTaskIds.includes(t.id));
  }

  // Update tab counts
  const runningCount = todayTasks.filter(t => t.status !== 'completed' && appData.runningTaskIds.includes(t.id)).length;
  const pendingCount = todayTasks.filter(t => t.status !== 'completed' && !appData.runningTaskIds.includes(t.id)).length;
  const completedCount = todayTasks.filter(t => t.status === 'completed').length;
  document.getElementById('runningCount').textContent = runningCount;
  document.getElementById('pendingCount').textContent = pendingCount;
  const cc = document.getElementById('completedCount');
  if (cc) cc.textContent = completedCount;

  // Auto-switch to pending tab if no running tasks
  if (currentTaskTab === 'running' && runningCount === 0 && pendingCount > 0) {
    switchTaskTab('pending');
    return; // Re-render with new tab
  }

  if (filtered.length === 0) {
    const msg = currentTaskTab === 'running' ? '暂无任务运行' : (currentTaskTab === 'completed' ? '没有已完成的任务' : '没有待执行的任务');
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>${msg}</p></div>`;
    document.getElementById('taskCount').textContent = `${todayTasks.length} / 10`;
    return;
  }

  const sorted = [...filtered].sort((a,b) => a.order - b.order);
  let html = '';
  sorted.forEach(t => {
    const running = appData.runningTaskIds.includes(t.id);
    const completed = t.status === 'completed';
    let cls = 'card';
    if (completed) cls += ' card--completed';
    else if (running) cls += ' card--running';
    else cls += ' card--paused';
    const otHtml = t.overtimeSeconds > 0 ? `<div class="card-overtime"><i class="fa-solid fa-circle-exclamation"></i> 超时 ${formatTime(t.overtimeSeconds)}</div>` : '';
    const descHtml = t.description ? `<div class="card-desc">${escHtml(t.description)}</div>` : '';
    const completeBtnHtml = completed
      ? `<span class="card-completed-badge"><i class="fa-solid fa-check"></i> 已完成</span>`
      : `<button class="btn btn-sm btn-ghost" data-action="complete"><i class="fa-solid fa-check"></i> 完成</button>`;
    html += `
    <div class="${cls}" data-task-id="${t.id}">
      <div class="card-header">
        <span class="card-name">${escHtml(t.name)}</span>
      </div>
      <div class="card-body">
        <div class="card-time">${formatTime(t.remainingSeconds)}</div>
        <div class="card-label" data-action="edit" style="cursor:pointer" title="点击编辑">剩余 / 预设 ${formatTime(t.presetSeconds)} <i class="fa-solid fa-pen" style="font-size:10px;opacity:0.4;margin-left:4px"></i></div>
        ${descHtml}
        ${otHtml}
      </div>
      <div class="card-actions">
        <div class="adjust-group">
          <button class="btn-adjust" data-action="adjust" data-delta="-900">-15'</button>
          <button class="btn-adjust" data-action="adjust" data-delta="-300">-5'</button>
          <button class="btn-adjust" data-action="adjust" data-delta="+300">+5'</button>
          <button class="btn-adjust" data-action="adjust" data-delta="+900">+15'</button>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          ${completeBtnHtml}
          <button class="btn btn-sm btn-ghost" data-action="edit"><i class="fa-solid fa-pen"></i> 编辑</button>
          <button class="btn-delete" data-action="delete"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>
    </div>`;
  });
  container.innerHTML = html;
  document.getElementById('taskCount').textContent = `${todayTasks.length} / 10`;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function updateStatusBar() {
  const taskList = document.getElementById('taskList');
  // Remove old status
  const oldStatus = document.getElementById('inlineTaskStatus');
  if (oldStatus) oldStatus.remove();

  if (appData.runningTaskIds.length > 0) {
    const names = appData.runningTaskIds.map(id => {
      const t = appData.tasks.find(x => x.id === id);
      return t ? escHtml(t.name) : '';
    }).filter(Boolean).join('、');
    const poolUsed = appData.poolUsedSeconds || 0;
    const totalWork = getTotalWorkSeconds();
    const overtime = Math.max(0, poolUsed - totalWork);
    const overtimeHtml = overtime > 0
      ? ` / <span style="color:var(--color-neon-pink)">超时 ${formatTime(overtime)}</span>`
      : '';
    const statusEl = document.createElement('div');
    statusEl.id = 'inlineTaskStatus';
    statusEl.className = 'task-status-running';
    statusEl.innerHTML = `<i class="fa-solid fa-circle-play"></i> <strong>${names}</strong>（已用 ${formatTime(poolUsed)} / 可支配 ${formatTime(totalWork)}${overtimeHtml}）`;
    taskList.insertBefore(statusEl, taskList.firstChild);
  }
}

// ========== Event Delegation ==========
document.addEventListener('click', function(e) {
  const card = e.target.closest('.card');
  if (!card) return;
  const taskId = card.dataset.taskId;
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === 'adjust') {
      adjustPreset(taskId, parseInt(actionEl.dataset.delta, 10));
    } else if (action === 'delete') {
      deleteTask(taskId);
    } else if (action === 'edit') {
      openEditTask(taskId);
    } else if (action === 'complete') {
      completeTask(taskId);
    }
    return;
  }
  // Don't start completed tasks
  if (card.classList.contains('card--completed')) return;
  startTask(taskId);
});

// ========== Add Task Modal ==========
function openAddTaskModal() {
  pickerState = { hours: 1, minutes: 0, mode: 'picker' };
  updatePickerDisplay();
  document.getElementById('inputTaskName').value = '';
  document.getElementById('inputTaskDesc').value = '';
  document.getElementById('inputCustomMinutes').value = '60';
  document.getElementById('addTaskModal').classList.add('active');
  switchTab('picker');
  setTimeout(() => document.getElementById('inputTaskName').focus(), 100);
}

function switchTab(mode) {
  pickerState.mode = mode;
  document.querySelectorAll('#addTaskModal .modal-tab').forEach(t => {
    t.classList.toggle('modal-tab--active', t.dataset.tab === mode);
  });
  document.getElementById('tabPicker').style.display = mode === 'picker' ? 'block' : 'none';
  document.getElementById('tabCustom').style.display = mode === 'custom' ? 'block' : 'none';
  if (mode === 'custom') document.getElementById('inputCustomMinutes').focus();
}

function updatePickerDisplay() {
  document.getElementById('pickerHours').textContent = pickerState.hours;
  document.getElementById('pickerMinutes').textContent = String(pickerState.minutes).padStart(2,'0');
  document.getElementById('pickerTotal').textContent = `${pickerState.hours*60+pickerState.minutes} 分钟`;
}

function adjustPicker(target, delta) {
  if (target === 'hours') pickerState.hours = Math.max(0, Math.min(23, pickerState.hours + delta));
  else { pickerState.minutes = Math.max(0, Math.min(55, pickerState.minutes + delta)); pickerState.minutes = Math.round(pickerState.minutes/5)*5; }
  if (pickerState.hours === 0 && pickerState.minutes === 0) pickerState.minutes = 1;
  updatePickerDisplay();
}

function confirmAddTask() {
  const name = document.getElementById('inputTaskName').value.trim();
  if (!name) { showToast('请输入任务名称'); return; }
  const desc = document.getElementById('inputTaskDesc').value.trim();
  let presetSec;
  if (pickerState.mode === 'picker') {
    const t = pickerState.hours*60 + pickerState.minutes;
    if (t < 1) { showToast('请至少设置 1 分钟'); return; }
    presetSec = t*60;
  } else {
    const m = parseInt(document.getElementById('inputCustomMinutes').value, 10);
    if (isNaN(m) || m < 1 || m > 1440) { showToast('请输入 1~1440 分钟'); return; }
    presetSec = m*60;
  }
  const ok = addTask(name, presetSec, desc);
  if (ok) closeModal('addTaskModal');
}

// ========== Edit Task ==========
function openEditTask(id) {
  const t = appData.tasks.find(x => x.id === id);
  if (!t) return;
  editTaskId = id;
  document.getElementById('editTaskNameInput').value = t.name;
  document.getElementById('editTaskDescInput').value = t.description || '';
  const presetH = Math.floor(t.presetSeconds / 3600);
  const presetM = Math.floor((t.presetSeconds % 3600) / 60);
  const usedH = Math.floor(t.usedSeconds / 3600);
  const usedM = Math.floor((t.usedSeconds % 3600) / 60);
  editPickerState = { preset: { hours: presetH, minutes: presetM }, used: { hours: usedH, minutes: usedM } };
  updateEditPickerDisplay('preset');
  updateEditPickerDisplay('used');
  document.getElementById('editTaskModal').classList.add('active');
}

function updateEditPickerDisplay(section) {
  const st = editPickerState[section];
  const cap = section.charAt(0).toUpperCase() + section.slice(1);
  document.getElementById('edit'+cap+'Hours').textContent = st.hours;
  document.getElementById('edit'+cap+'Minutes').textContent = String(st.minutes).padStart(2,'0');
}

function adjustEditPicker(section, unit, delta) {
  const st = editPickerState[section];
  if (unit === 'hours') st.hours = Math.max(0, Math.min(23, st.hours + delta));
  else { st.minutes = Math.max(0, Math.min(55, st.minutes + delta)); st.minutes = Math.round(st.minutes/5)*5; }
  if (section === 'preset' && st.hours === 0 && st.minutes === 0) st.minutes = 1;
  updateEditPickerDisplay(section);
}

function confirmEditTask() {
  const t = appData.tasks.find(x => x.id === editTaskId);
  if (!t) return;
  const newName = document.getElementById('editTaskNameInput').value.trim();
  if (newName) t.name = newName;
  t.description = document.getElementById('editTaskDescInput').value.trim();
  const newPre = editPickerState.preset.hours * 3600 + editPickerState.preset.minutes * 60;
  if (newPre < 60) { showToast('预设时长至少 1 分钟'); return; }

  if (t.status === 'completed') {
    // Completed tasks: used = preset, remaining = 0
    t.presetSeconds = newPre;
    t.usedSeconds = newPre;
    t.remainingSeconds = 0;
    t.overtimeSeconds = 0;
  } else {
    const newUsed = editPickerState.used.hours * 3600 + editPickerState.used.minutes * 60;
    t.presetSeconds = newPre;
    const diffUsed = newUsed - t.usedSeconds;
    if (diffUsed > 0) {
      if (t.remainingSeconds >= diffUsed) t.remainingSeconds -= diffUsed;
      else { const remaining = t.remainingSeconds; t.remainingSeconds = 0; t.overtimeSeconds += (diffUsed - remaining); }
      t.usedSeconds = newUsed;
    } else if (diffUsed < 0) {
      const absDiff = Math.abs(diffUsed);
      if (t.overtimeSeconds >= absDiff) { t.overtimeSeconds -= absDiff; t.remainingSeconds = 0; }
      else { const leftover = absDiff - t.overtimeSeconds; t.overtimeSeconds = 0; t.remainingSeconds = Math.min(t.remainingSeconds + leftover, t.presetSeconds); }
      t.usedSeconds = newUsed;
    }
    if (t.remainingSeconds < 0) { t.overtimeSeconds += Math.abs(t.remainingSeconds); t.remainingSeconds = 0; }
  }
  saveData();
  closeModal('editTaskModal');
  renderTasks();
  updateTimeAxis();
  updateStatusBar();
  showToast('任务已更新');
}

// ========== End Time Check ==========
function checkEndTime() {
  if (!appData.settings || appData.runningTaskIds.length === 0) return;
  if (endTimeDialogData) return; // Already showing dialog
  if (endTimeExtendPending) return; // User is in the process of extending time
  if (_endTimeAlreadyPast) return; // End time was already past when app loaded — wait for user to extend

  const now = new Date();
  const nowSec = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();
  const endSec = timeToSeconds(appData.settings.workEnd);

  if (nowSec >= endSec) {
    // Pause all tasks first
    doTick();

    const type = appData.settings.modeType;
    endTimeDialogData = { type, currentEnd: appData.settings.workEnd };

    const icon = document.getElementById('endTimeIcon');
    const msg = document.getElementById('endTimeMsg');
    const btn = document.getElementById('endTimeExtendBtn');

    if (type === 'efficiency') {
      icon.textContent = '⚡';
      msg.textContent = '贤者模式已结束，是否继续高效？';
      btn.textContent = '继续高效';
    } else {
      icon.textContent = '🐂';
      msg.textContent = '下班时间已到，是否需要加班？';
      btn.textContent = '继续加班';
    }

    document.getElementById('endTimeDialog').classList.add('active');
  }
}

function endTimeDecline() {
  document.getElementById('endTimeDialog').classList.remove('active');
  endTimeDialogData = null;
  _endTimeAlreadyPast = true; // Prevent re-popup
  // Auto-settle the day
  settleDay('normal');
  showToast('今日已结算');
  // Navigate to stats page
  setTimeout(() => { toggleStats(); }, 800);
}

function endTimeExtend() {
  document.getElementById('endTimeDialog').classList.remove('active');
  const data = endTimeDialogData;
  endTimeDialogData = null;
  endTimeExtendPending = true; // Prevent re-popup while user sets new time
  openExtendTimeModal(data.type);
}

function openExtendTimeModal(type) {
  const now = new Date();
  const nowH = now.getHours();
  const nowM = now.getMinutes();

  // Set current time as minimum start
  const startH = Math.min(nowH, 22);
  const startM = Math.max(0, nowH > 22 ? 0 : nowM);

  document.getElementById('extendStartHour').value = startH;
  document.getElementById('extendStartMin').value = Math.round(startM/5)*5;
  document.getElementById('extendEndHour').value = 23;
  document.getElementById('extendEndMin').value = 55;

  if (type === 'efficiency') {
    document.getElementById('extendTimeTitle').innerHTML = '<i class="fa-solid fa-clock"></i> 延长高效时间';
    document.getElementById('extendStartLabel').textContent = '贤者开始时间';
    document.getElementById('extendEndLabel').textContent = '贤者结束时间';
  } else {
    document.getElementById('extendTimeTitle').innerHTML = '<i class="fa-solid fa-clock"></i> 加班时间';
    document.getElementById('extendStartLabel').textContent = '开始时间';
    document.getElementById('extendEndLabel').textContent = '结束时间';
  }

  extendTimeEndSec = 23*3600 + 55*60;
  document.getElementById('extendTimeModal').classList.add('active');
  updateExtendPool();

  // Add listeners
  ['extendStartHour','extendStartMin','extendEndHour','extendEndMin'].forEach(id => {
    const el = document.getElementById(id);
    el.onchange = function() {
      updateExtendPool();
      validateExtendTime();
    };
  });
}

function initExtendSelects() {
  ['extendStartHour','extendStartMin','extendEndHour','extendEndMin'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isMin = id.includes('Min');
    el.innerHTML = '';
    for (let i = 0; i < (isMin ? 60 : 24); i += (isMin ? 5 : 1)) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = String(i).padStart(2, '0');
      el.appendChild(o);
    }
  });
}

function validateExtendTime() {
  const sh = parseInt(document.getElementById('extendStartHour').value);
  const sm = parseInt(document.getElementById('extendStartMin').value);
  const eh = parseInt(document.getElementById('extendEndHour').value);
  const em = parseInt(document.getElementById('extendEndMin').value);
  const startSec = sh*3600+sm*60;
  const endSec = eh*3600+em*60;

  const now = new Date();
  const nowSec = now.getHours()*3600+now.getMinutes()*60+now.getSeconds();

  const err = document.getElementById('extendTimeError');
  if (startSec < nowSec-60) {
    err.textContent = '开始时间不能早于当前时间';
    err.style.display = 'block';
    return false;
  }
  if (endSec <= startSec) {
    err.textContent = '结束时间必须晚于开始时间';
    err.style.display = 'block';
    return false;
  }
  err.style.display = 'none';
  return true;
}

function updateExtendPool() {
  const sh = parseInt(document.getElementById('extendStartHour').value);
  const sm = parseInt(document.getElementById('extendStartMin').value);
  const eh = parseInt(document.getElementById('extendEndHour').value);
  const em = parseInt(document.getElementById('extendEndMin').value);
  const pool = (eh*3600+em*60) - (sh*3600+sm*60);
  document.getElementById('extendPoolInfo').textContent = pool > 0 ? formatTime(pool) : '—';
}

function confirmExtendTime() {
  if (!validateExtendTime()) return;

  const sh = parseInt(document.getElementById('extendStartHour').value);
  const sm = parseInt(document.getElementById('extendStartMin').value);
  const eh = parseInt(document.getElementById('extendEndHour').value);
  const em = parseInt(document.getElementById('extendEndMin').value);

  // Extend work end time
  const newEnd = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
  const newStart = `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`;

  // Update settings
  appData.settings.workStart = newStart;
  appData.settings.workEnd = newEnd;
  if (appData.todayMode) {
    appData.todayMode.workStart = newStart;
    appData.todayMode.workEnd = newEnd;
  }

  saveData();
  closeModal('extendTimeModal');
  endTimeExtendPending = false; // Extension confirmed, clear flag
  _endTimeAlreadyPast = false; // Reset — new end time is in the future, allow re-check
  showToast('工作时间已延长');

  // Resume running tasks
  lastTickTime = Date.now();
  updateUI();
}

// ========== Stats ==========
function toggleStats() {
  const tv = document.getElementById('timerView');
  const sv = document.getElementById('statsView');
  if (sv.classList.contains('active')) {
    sv.classList.remove('active');
    tv.classList.remove('hidden');
  } else {
    tv.classList.add('hidden');
    sv.classList.add('active');
    if (!statsInitialized) {
      const now = new Date();
      calendarViewYear = now.getFullYear();
      calendarViewMonth = now.getMonth();
      statsInitialized = true;
    }
    renderCalendar();
    renderCumulative();
  }
}

function changeMonth(delta) {
  calendarViewMonth += delta;
  if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear--; }
  if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear++; }
  renderCalendar();
}

function renderCalendar() {
  const label = document.getElementById('calendarMonthLabel');
  label.textContent = `${calendarViewYear}年${calendarViewMonth+1}月`;

  const grid = document.getElementById('calendarGrid');
  const firstDay = new Date(calendarViewYear, calendarViewMonth, 1);
  const daysInMonth = new Date(calendarViewYear, calendarViewMonth+1, 0).getDate();
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const today = getTodayStr();
  let html = '';
  for (let i = 0; i < startDow; i++) html += '<div class="calendar-day calendar-day--empty"></div>';

  const allEntries = Object.entries(appData.calendar).filter(([d]) => {
    const p = d.split('-');
    return parseInt(p[0]) === calendarViewYear && parseInt(p[1]) === calendarViewMonth+1;
  });
  const maxUsed = Math.max(...allEntries.map(([,c]) => c.totalUsedSeconds || 0), 1);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calendarViewYear}-${String(calendarViewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === today;
    const dayData = appData.calendar[dateStr];
    const hasData = dayData && dayData.totalUsedSeconds > 0;
    const totalStr = hasData ? formatShort(dayData.totalUsedSeconds) : '';
    let bg = '';
    if (hasData) {
      const opacity = Math.min(0.35, Math.max(0.04, (dayData.totalUsedSeconds / maxUsed) * 0.35));
      // Overtime mode: blue; Efficiency mode: violet
      const color = dayData.modeType === 'efficiency' ? '167,112,255' : '0,98,255';
      bg = `background:rgba(${color},${opacity})`;
    }

    html += `<div class="calendar-day${isToday?' calendar-day--today':''}" ${bg ? `style="${bg}"` : ''} onclick="showDayDetail('${dateStr}')">
      <span class="calendar-day-num">${d}</span>
      ${hasData ? `<span class="calendar-day-used">${totalStr}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
}

function showDayDetail(dateStr) {
  const dayData = appData.calendar[dateStr];
  const d = new Date(dateStr);
  document.getElementById('detailDate').textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;

  // Mode info
  const modeInfo = document.getElementById('detailModeInfo');
  if (dayData && dayData.modeType) {
    const modeLabel = dayData.modeType === 'efficiency' ? '效率模式' : '牛马模式';
    modeInfo.innerHTML = `<span class="daily-detail-mode">${modeLabel}</span>`;
  } else {
    modeInfo.innerHTML = '';
  }

  const list = document.getElementById('detailList');
  if (!dayData || !dayData.tasks || Object.keys(dayData.tasks).length === 0) {
    list.innerHTML = '<div style="padding:16px 0;text-align:center;color:var(--color-silver);font-size:14px">当日无记录</div>';
    document.getElementById('dailyDetailPopup').classList.add('active');
    return;
  }

  const tasksArr = Object.entries(dayData.tasks)
    .map(([id, td]) => ({ id, name: td.name||id, usedSeconds: td.usedSeconds||0, overtimeSeconds: td.overtimeSeconds||0 }))
    .sort((a,b) => b.usedSeconds - a.usedSeconds);

  let html = '';
  tasksArr.forEach((item, idx) => {
    const medal = idx===0 ? '<i class="fa-solid fa-trophy" style="color:var(--color-golden-orb)"></i>'
                : idx===1 ? '<i class="fa-solid fa-medal" style="color:var(--color-silver)"></i>'
                : idx===2 ? '<i class="fa-solid fa-medal" style="color:var(--color-golden-orb);opacity:0.6"></i>'
                : `<span class="daily-detail-rank">#${idx+1}</span>`;
    const otHtml = item.overtimeSeconds > 0 ? `<span style="color:var(--color-neon-pink);font-size:12px;margin-left:8px">+${formatShort(item.overtimeSeconds)}</span>` : '';
    html += `<div class="daily-detail-row">
      <span style="display:flex;align-items:center;gap:8px"><span>${medal}</span><span class="daily-detail-name">${escHtml(item.name)}</span></span>
      <span><span class="daily-detail-time">${formatTime(item.usedSeconds)}</span>${otHtml}</span>
    </div>`;
  });

  const total = dayData.totalUsedSeconds||0;
  const overtime = dayData.totalOvertimeSeconds||0;
  const unallocated = dayData.unallocatedSeconds||0;
  const status = dayData.status||'normal';
  html += `<div class="daily-detail-total"><span>合计</span><span>${formatTime(total)}${overtime>0?` <span style="color:var(--color-neon-pink)">(+${formatTime(overtime)})</span>`:''}</span></div>`;
  if (status === 'early_end') html += `<div style="font-size:12px;color:var(--color-golden-orb);margin-top:8px;text-align:center"><i class="fa-solid fa-flag"></i> 提前结束，未使用 ${formatTime(unallocated)}</div>`;

  list.innerHTML = html;
  document.getElementById('dailyDetailPopup').classList.add('active');
}

function renderCumulative() {
  const el = document.getElementById('cumulativeList');
  // Only show tasks that have actual time records (used or overtime)
  const sorted = [...appData.tasks]
    .filter(t => (t.usedSeconds || 0) > 0 || (t.overtimeSeconds || 0) > 0)
    .sort((a,b) => b.usedSeconds - a.usedSeconds);
  if (sorted.length === 0) {
    el.innerHTML = '<div style="padding:16px 0;text-align:center;color:var(--color-silver);font-size:13px">暂无任务记录</div>';
    return;
  }
  let html = '';
  sorted.forEach(t => {
    html += `<div class="cumulative-row">
      <span class="cumulative-name">${escHtml(t.name)}</span>
      <span class="cumulative-stats">
        累计 <span class="cumulative-val">${formatTime(t.usedSeconds)}</span>
        ${t.overtimeSeconds>0?`超时 <span class="cumulative-val" style="color:var(--color-neon-pink)">${formatTime(t.overtimeSeconds)}</span>`:''}
      </span>
    </div>`;
  });
  el.innerHTML = html;
}


// ========== Early End ==========
function confirmEarlyEnd() {
  var dlg = document.getElementById('earlyEndDialog');
  if (!dlg) { alert('弹窗元素未找到！'); return; }
  dlg.style.display = 'flex';
  dlg.classList.add('active');
}

function doEarlyEnd() {
  var dlg = document.getElementById('earlyEndDialog');
  if (dlg) { dlg.style.display = 'none'; dlg.classList.remove('active'); }
  doTick();
  appData.runningTaskIds = [];
  lastTickTime = null;
  settleDay('early_end');
  saveData();
  showToast('今日已结算');

  // Navigate to stats page
  setTimeout(() => {
    toggleStats();
  }, 800);
}

// ========== Go Home (Switch Mode) ==========
function confirmGoHome() {
  if (appData.runningTaskIds.length > 0) {
    doTick();
    appData.runningTaskIds = [];
    lastTickTime = null;
  }
  // Settle today's data into calendar
  if (appData.tasks.length > 0) {
    settleDay('switch_mode');
  }
  // Clear mode & tasks
  appData.settings = null;
  appData.todayMode = null;
  appData.tasks = [];
  appData.poolUsedSeconds = 0;
  saveData();
  // Navigate back to mode page
  document.getElementById('appContainer').classList.remove('active');
  document.getElementById('welcomePage').classList.add('active');
  // If stats page is open, close it
  const statsPage = document.getElementById('statsPage');
  if (statsPage) statsPage.classList.remove('active');
  showToast('已回到首页，请重新选择模式');
}

function settleDay(status) {
  const today = getTodayStr();
  if (!appData.calendar[today]) appData.calendar[today] = {
    tasks: {}, totalUsedSeconds: 0, totalOvertimeSeconds: 0,
    unallocatedSeconds: 0, status: 'normal',
    modeType: appData.settings ? appData.settings.modeType : 'overtime'
  };

  const cal = appData.calendar[today];
  cal.modeType = appData.settings ? appData.settings.modeType : 'overtime';

  appData.tasks.forEach(t => {
    if (!cal.tasks[t.id]) cal.tasks[t.id] = { name: t.name, usedSeconds: 0, overtimeSeconds: 0, description: t.description || '' };
    cal.tasks[t.id].usedSeconds += t.usedSeconds;
    cal.tasks[t.id].overtimeSeconds += t.overtimeSeconds;
    cal.tasks[t.id].description = t.description || '';
  });

  cal.totalUsedSeconds = appData.poolUsedSeconds || appData.tasks.reduce((s,t) => s + t.usedSeconds, 0);
  cal.totalOvertimeSeconds = appData.tasks.reduce((s,t) => s + t.overtimeSeconds, 0);
  cal.unallocatedSeconds = Math.max(0, getTotalWorkSeconds() - cal.totalUsedSeconds);
  cal.status = status;

  // Reset tasks
  appData.tasks.forEach(t => { t.remainingSeconds = t.presetSeconds; t.usedSeconds = 0; t.overtimeSeconds = 0; });
  appData.poolUsedSeconds = 0;
  saveData();
  renderTasks();
  updateTimeAxis();
  updateStatusBar();
}

// ========== Modal Helpers ==========
function closeModal(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active');
  // Also reset inline display for dialogs that may have been set directly
  if (id === 'earlyEndDialog') el.style.display = 'none';
  if (id === 'extendTimeModal') {
    endTimeExtendPending = false; // User cancelled extension, allow re-check
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove('show'), 2500);
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active, .daily-detail-popup.active, .confirm-dialog.active').forEach(el => {
      el.classList.remove('active');
    });
    endTimeDialogData = null;
    var ed = document.getElementById('earlyEndDialog');
    if (ed) { ed.classList.remove('active'); ed.style.display = 'none'; }
  }
  if (document.getElementById('addTaskModal').classList.contains('active') && e.key === 'Enter' && !e.isComposing) confirmAddTask();
});

// ========== UI Helper ==========
function updateUI() {
  updateTimeAxis();
  updateStatusBar();
  renderTasks();
}

// ========== Init ==========
function initApp() {
  // Inject demo calendar data if empty (so stats page is never blank)
  ensureDemoData();

  // Set multi-task toggle
  document.getElementById('multiTaskToggle').checked = appData.multiTaskEnabled;

  // Suppress end-time dialog if end time already passed on startup
  if (appData.settings) {
    const now = new Date();
    const nowSec = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();
    const endSec = timeToSeconds(appData.settings.workEnd);
    _endTimeAlreadyPast = (nowSec >= endSec);
  }

  // 2-second boot buffer to avoid immediate popup
  endTimeExtendPending = true;
  setTimeout(() => { endTimeExtendPending = false; }, 2000);

  renderTasks();
  updateTimeAxis();
  updateStatusBar();

  setInterval(timerTick, 500);
  setInterval(() => { if (appData.runningTaskIds.length > 0) saveData(); }, 10000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (appData.runningTaskIds.length > 0) { doTick(); saveData(); } }
    else if (appData.runningTaskIds.length > 0) { doTick(); updateUI(); }
  });

  window.addEventListener('focus', () => {
    if (appData.runningTaskIds.length > 0) { doTick(); updateUI(); }
  });

  window.addEventListener('beforeunload', () => {
    if (appData.runningTaskIds.length > 0) { doTick(); saveData(); }
  });
}

// ========== V1 Data Migration ==========
function migrateV1Data() {
  if (Object.keys(appData.calendar).length > 0) return;
  const v1Tasks = {
    'task_1785290848252_is1557': 'personal（r）',
    'task_1785290904534_gc3znq': 'work',
    'task_1785290940429_tyk2dr': 'videcoding',
    'task_1785374689166_ul8kcr': 'GAP'
  };
  const v1History = {
    'task_1785290848252_is1557': { totalUsedSeconds: 4734, totalOvertimeSeconds: 534 },
    'task_1785290904534_gc3znq': { totalUsedSeconds: 2791, totalOvertimeSeconds: 0 },
    'task_1785290940429_tyk2dr': { totalUsedSeconds: 2937, totalOvertimeSeconds: 237 }
  };
  const dateStr = '2026-07-29';
  appData.calendar[dateStr] = {
    tasks: {}, totalUsedSeconds: 0, totalOvertimeSeconds: 0,
    status: 'normal', modeType: 'overtime'
  };
  const cal = appData.calendar[dateStr];
  Object.entries(v1History).forEach(([id, stats]) => {
    cal.tasks[id] = { name: v1Tasks[id]||id, usedSeconds: stats.totalUsedSeconds, overtimeSeconds: stats.totalOvertimeSeconds };
    cal.totalUsedSeconds += stats.totalUsedSeconds;
    cal.totalOvertimeSeconds += stats.totalOvertimeSeconds;
  });
  saveData();
}

// ========== Cross-day Detection ==========
function checkDayReset() {
  const today = getTodayStr();
  if (appData.todayMode && appData.todayMode.date !== today) {
    // Yesterday's data not settled — auto-settle
    settleDay('normal');
    appData.todayMode = null;
    appData.settings = null;
    appData.runningTaskIds = [];
    lastTickTime = null;
    saveData();
    return true; // Day was reset
  }
  return false;
}

// ========== Bootstrap ==========
initAllSelects();
migrateV1Data();

// Cross-day check before deciding which page to show
checkDayReset();

// Determine which page to show
const now = new Date();
const nowHour = now.getHours();

if (nowHour >= 5) {
  // After 5am, always show welcome page
  document.getElementById('welcomePage').classList.add('active');
} else {
  // Before 5am, skip welcome (深夜不需要欢迎页)
  if (appData.settings) {
    document.getElementById('appContainer').classList.add('active');
    initApp();
  } else {
    document.getElementById('modePage').classList.add('active');
  }
}
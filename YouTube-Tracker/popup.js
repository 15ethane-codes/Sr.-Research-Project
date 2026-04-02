console.log('Popup opened');

// ---- CONSTANTS ----
const SCROLL_COLOR   = '#667eea';
const WATCH_COLOR    = '#764ba2';
const SHORTS_COLOR   = '#34E89E';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup DOM loaded');

  const result = await browser.storage.local.get([
    'mlInterval',
    'intervalLocked',
    'intervalConfirmedForSession'
  ]);

  const currentSessionId = await getCurrentSessionId();
  const confirmedValue = result.intervalConfirmedForSession;
  const alreadyConfirmed =
    confirmedValue === 'pre-session' ||
    confirmedValue === currentSessionId;

  if (!currentSessionId) {
    await initMainView();
    return;
  }

  if (alreadyConfirmed) {
    await initMainView();
  } else {
    showIntervalPicker(result.mlInterval || 5, currentSessionId);
  }
});

async function getCurrentSessionId() {
  try {
    const response = await browser.runtime.sendMessage({ action: 'getCurrentSessionId' });
    return response && response.sessionId ? response.sessionId : null;
  } catch (e) {
    return null;
  }
}

// ---- INTERVAL PICKER ----
function showIntervalPicker(previousValue, currentSessionId) {
  document.getElementById('onboarding').classList.add('visible');
  document.getElementById('main-view').classList.add('hidden');

  const options    = document.querySelectorAll('.onboarding-option');
  const confirmBtn = document.getElementById('confirmInterval');
  const sliderRow  = document.getElementById('onboardingSliderRow');
  const slider     = document.getElementById('onboardingSlider');
  const sliderVal  = document.getElementById('onboardingSliderValue');

  let selectedValue = previousValue;

  if ([2, 5, 10].includes(previousValue)) {
    const match = document.querySelector(`.onboarding-option[data-value="${previousValue}"]`);
    if (match) match.classList.add('selected');
    sliderRow.style.display = 'none';
  } else {
    const customOpt = document.querySelector('.onboarding-option[data-value="custom"]');
    if (customOpt) customOpt.classList.add('selected');
    slider.value = Math.min(Math.max(previousValue, 2), 10);
    sliderVal.textContent = slider.value;
    sliderRow.style.display = 'flex';
  }

  confirmBtn.disabled = false;

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      if (opt.dataset.value === 'custom') {
        sliderRow.style.display = 'flex';
        selectedValue = parseInt(slider.value);
      } else {
        sliderRow.style.display = 'none';
        selectedValue = parseInt(opt.dataset.value);
      }
      confirmBtn.disabled = false;
    });
  });

  slider.addEventListener('input', () => {
    sliderVal.textContent = slider.value;
    selectedValue = parseInt(slider.value);
  });

  confirmBtn.addEventListener('click', async () => {
    if (!selectedValue) return;
    await browser.storage.local.set({
      mlInterval: selectedValue,
      intervalLocked: true,
      intervalConfirmedForSession: currentSessionId || 'pre-session'
    });
    browser.runtime.sendMessage({ action: 'updateMLInterval', value: selectedValue });
    console.log('[Picker] Confirmed and locked:', selectedValue, 'min for session:', currentSessionId || 'pre-session');
    document.getElementById('onboarding').classList.remove('visible');
    document.getElementById('main-view').classList.remove('hidden');
    await initMainView();
  });
}

// ---- MAIN VIEW ----
async function initMainView() {
  const sessions = await loadScrollData();
  setupViewToggle(sessions);
  setupEventListeners();
  await setupIntervalControls();
  listenForLockChanges();
}

async function loadScrollData() {
  try {
    console.log('Requesting scroll data from background...');
    const response = await browser.runtime.sendMessage({ action: 'getScrollData' });
    const sessions = response.data || [];
    console.log('Total sessions:', sessions.length);
    displayStats(sessions);
    displayRecentActivity(sessions);
    return sessions;
  } catch (error) {
    console.error('Error loading data:', error);
    document.getElementById('recentList').innerHTML = '<div class="loading">Error loading data</div>';
    return [];
  }
}

// ---- STATS / CHART TOGGLE ----
function setupViewToggle(sessions) {
  const btnStats = document.getElementById('btnStats');
  const btnChart = document.getElementById('btnChart');
  const statsView = document.getElementById('statsView');
  const chartView = document.getElementById('chartView');

  btnStats.addEventListener('click', () => {
    btnStats.classList.add('active');
    btnChart.classList.remove('active');
    statsView.style.display = '';
    chartView.classList.remove('visible');
  });

  btnChart.addEventListener('click', () => {
    btnChart.classList.add('active');
    btnStats.classList.remove('active');
    statsView.style.display = 'none';
    chartView.classList.add('visible');
    renderChart(sessions);
  });
}

// ---- STATS ----
function displayStats(sessions) {
  if (sessions.length === 0) {
    document.getElementById('totalTime').textContent = '0';
    document.getElementById('totalSessions').textContent = '0';
    document.getElementById('avgDuration').textContent = '0m';
    document.getElementById('videoClicks').textContent = '0';
    return;
  }

  const totalDuration = sessions.reduce((sum, s) => sum + (s.sessionDuration || 0), 0);
  const totalClicks   = sessions.reduce((sum, s) => sum + (s.totalClicks || 0), 0);
  const totalMinutes  = Math.round(totalDuration / 1000 / 60);
  const avgMinutes    = Math.round((totalDuration / sessions.length) / 1000 / 60);

  document.getElementById('totalTime').textContent     = totalMinutes;
  document.getElementById('totalSessions').textContent = sessions.length;
  document.getElementById('avgDuration').textContent   = avgMinutes + 'm';
  document.getElementById('videoClicks').textContent   = totalClicks;
}

// ---- SVG CHART ----
function renderChart(sessions) {
  const svg = document.getElementById('activityChart');
  svg.innerHTML = '';

  if (!sessions.length) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', '165');
    t.setAttribute('y', '70');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', 'rgba(255,255,255,0.5)');
    t.setAttribute('font-size', '12');
    t.textContent = 'No session data yet';
    svg.appendChild(t);
    return;
  }

  // Use last 5 sessions sorted oldest to newest
  const recent = [...sessions]
    .sort((a, b) => (a.savedAt || a.timestamp) - (b.savedAt || b.timestamp))
    .slice(-5);

  const W = 330;
  const H = 140;
  const padLeft = 30;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 28;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const barGap = 6;
  const barW = (chartW - barGap * (recent.length - 1)) / recent.length;

  // Find max duration for scaling
  const maxDuration = Math.max(...recent.map(s => s.sessionDuration || 0), 1);

  recent.forEach((session, i) => {
    const duration     = session.sessionDuration || 0;
    const watchMs      = session.timeWatchingVideo || 0;
    const shortsMs     = session.timeInShorts || 0;
    const scrollMs     = Math.max(0, duration - watchMs - shortsMs);

    const totalH       = (duration / maxDuration) * chartH;
    const watchH       = (watchMs / maxDuration) * chartH;
    const shortsH      = (shortsMs / maxDuration) * chartH;
    const scrollH      = Math.max(0, totalH - watchH - shortsH);

    const x = padLeft + i * (barW + barGap);
    let y = padTop + chartH; // start from bottom

    // Draw scroll segment (bottom)
    if (scrollH > 0) {
      y -= scrollH;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', scrollH);
      rect.setAttribute('fill', SCROLL_COLOR);
      rect.setAttribute('rx', scrollH === totalH ? '3' : '0');
      svg.appendChild(rect);
    }

    // Draw watch segment (middle)
    if (watchH > 0) {
      y -= watchH;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', watchH);
      rect.setAttribute('fill', WATCH_COLOR);
      svg.appendChild(rect);
    }

    // Draw shorts segment (top)
    if (shortsH > 0) {
      y -= shortsH;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', shortsH);
      rect.setAttribute('fill', SHORTS_COLOR);
      rect.setAttribute('rx', '3');
      svg.appendChild(rect);
    }

    // Round top corners on the topmost visible segment
    // (handled by rx on individual segments above for top/bottom)

    // Label below bar
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', x + barW / 2);
    label.setAttribute('y', H - 8);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', 'rgba(255,255,255,0.7)');
    label.setAttribute('font-size', '9');
    label.textContent = formatTimeAgo(session.savedAt || session.timestamp);
    svg.appendChild(label);
  });

  // Y axis duration labels
  const yLabels = [0, 0.5, 1];
  yLabels.forEach(frac => {
    const yPos = padTop + chartH * (1 - frac);
    const mins = Math.round((maxDuration * frac) / 1000 / 60);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padLeft - 4);
    line.setAttribute('x2', W - padRight);
    line.setAttribute('y1', yPos);
    line.setAttribute('y2', yPos);
    line.setAttribute('stroke', 'rgba(255,255,255,0.1)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', padLeft - 6);
    t.setAttribute('y', yPos + 3);
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('fill', 'rgba(255,255,255,0.5)');
    t.setAttribute('font-size', '8');
    t.textContent = mins + 'm';
    svg.appendChild(t);
  });
}

// ---- SESSION HISTORY ----
function displayRecentActivity(sessions) {
  const recentList = document.getElementById('recentList');

  if (!sessions.length) {
    recentList.innerHTML = '<div class="loading">No data yet. Visit YouTube to start tracking!</div>';
    return;
  }

  const recent = [...sessions]
    .sort((a, b) => (b.savedAt || b.timestamp) - (a.savedAt || a.timestamp))
    .slice(0, 5);

  recentList.innerHTML = '';

  recent.forEach((session, idx) => {
    const duration   = session.sessionDuration || 0;
    const clicks     = session.totalClicks || 0;
    const watchMs    = session.timeWatchingVideo || 0;
    const shortsMs   = session.timeInShorts || 0;
    const scrollMs   = Math.max(0, duration - watchMs - shortsMs);
    const scrollDist = session.totalScrollDistance || 0;
    const timeAgo    = formatTimeAgo(session.savedAt || session.timestamp);
    const durationMin = Math.round(duration / 1000 / 60);

    // Scroll intensity
    const durationMinExact = duration / 1000 / 60;
    const intensity = durationMinExact > 0 ? scrollDist / durationMinExact : 0;
    const intensityLabel = intensity < 500 ? 'Low' : intensity < 2000 ? 'Medium' : 'High';
    const intensityClass = intensity < 500 ? 'intensity-low' : intensity < 2000 ? 'intensity-med' : 'intensity-high';

    // Context bar widths
    const scrollPct = duration > 0 ? (scrollMs / duration) * 100 : 0;
    const watchPct  = duration > 0 ? (watchMs  / duration) * 100 : 0;
    const shortsPct = duration > 0 ? (shortsMs / duration) * 100 : 0;

    const item = document.createElement('div');
    item.className = 'activity-item';

    item.innerHTML = `
      <div class="activity-summary" data-idx="${idx}">
        <span class="activity-main">
          <strong>${durationMin}m</strong> • ${clicks} clicks • ${timeAgo}
        </span>
        <span class="activity-chevron" id="chevron-${idx}">▼</span>
      </div>
      <div class="activity-detail" id="detail-${idx}">
        <div class="detail-bar-row">
          <div class="detail-bar-label">Time breakdown</div>
          <div class="detail-bar">
            <div class="detail-bar-segment" style="width:${scrollPct}%;background:${SCROLL_COLOR};"></div>
            <div class="detail-bar-segment" style="width:${watchPct}%;background:${WATCH_COLOR};"></div>
            <div class="detail-bar-segment" style="width:${shortsPct}%;background:${SHORTS_COLOR};"></div>
          </div>
        </div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">Scrolling</div>
            <div class="detail-value">${formatMs(scrollMs)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Watching</div>
            <div class="detail-value">${formatMs(watchMs)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Shorts</div>
            <div class="detail-value">${formatMs(shortsMs)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Scroll Distance</div>
            <div class="detail-value">${formatScrollDist(scrollDist)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Scroll Events</div>
            <div class="detail-value">${Array.isArray(session.scrollEvents) ? session.scrollEvents.length : 0}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Intensity</div>
            <div class="detail-value ${intensityClass}">${intensityLabel}</div>
          </div>
        </div>
      </div>
    `;

    recentList.appendChild(item);

    // Click to expand/collapse
    item.querySelector('.activity-summary').addEventListener('click', () => {
      const detail  = document.getElementById(`detail-${idx}`);
      const chevron = document.getElementById(`chevron-${idx}`);
      const isOpen  = detail.classList.contains('visible');
      detail.classList.toggle('visible', !isOpen);
      chevron.classList.toggle('open', !isOpen);
    });
  });
}

// ---- HELPERS ----
function formatMs(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatScrollDist(px) {
  if (px >= 1000) return (px / 1000).toFixed(1) + 'k px';
  return Math.round(px) + ' px';
}

function formatTimeAgo(timestamp) {
  const diff    = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  const hours   = Math.round(diff / 3600000);
  const days    = Math.round(diff / 86400000);

  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  if (hours < 24)   return hours === 1 ? '1h ago' : `${hours}h ago`;
  if (days === 1)   return 'yesterday';
  return `${days}d ago`;
}

// ---- EVENT LISTENERS ----
function setupEventListeners() {
  document.getElementById('clearData').addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all tracking data?')) {
      const settings = await browser.storage.local.get([
        'mlInterval', 'intervalLocked', 'intervalConfirmedForSession'
      ]);
      await browser.storage.local.clear();
      await browser.storage.local.set(settings);
      await loadScrollData();
      alert('Data cleared successfully!');
    }
  });

  document.getElementById('exportData').addEventListener('click', async () => {
    try {
      const response = await browser.runtime.sendMessage({ action: 'getScrollData' });
      const sessions = response.data || [];
      if (!sessions.length) { alert('No data to export!'); return; }
      exportToCSV(sessions);
    } catch (error) {
      console.error('Error exporting data:', error);
      alert('Error exporting data');
    }
  });
}

// ---- INTERVAL CONTROLS ----
async function setupIntervalControls() {
  const radios      = document.querySelectorAll('input[name="mlInterval"]');
  const slider      = document.getElementById('customSlider');
  const customValue = document.getElementById('customValue');

  const result = await browser.storage.local.get(['mlInterval', 'intervalLocked']);
  const saved  = result.mlInterval || 5;
  const locked = result.intervalLocked || false;

  if ([2, 5, 10].includes(saved)) {
    document.querySelector(`input[name="mlInterval"][value="${saved}"]`).checked = true;
    slider.disabled = true;
  } else {
    document.querySelector('input[name="mlInterval"][value="custom"]').checked = true;
    slider.disabled = false;
    slider.value = Math.min(Math.max(saved, 2), 10); // clamp to new range
    customValue.textContent = slider.value;
  }

  applyLockState(locked, saved);

  radios.forEach(radio => {
    radio.addEventListener('change', async () => {
      const currentLock = (await browser.storage.local.get(['intervalLocked'])).intervalLocked;
      if (currentLock) return;
      if (radio.value === 'custom') {
        slider.disabled = false;
        saveMLInterval(parseInt(slider.value));
      } else {
        slider.disabled = true;
        saveMLInterval(parseInt(radio.value));
      }
    });
  });

  slider.addEventListener('input', async () => {
    const currentLock = (await browser.storage.local.get(['intervalLocked'])).intervalLocked;
    if (currentLock) return;
    customValue.textContent = slider.value;
    if (document.querySelector('input[name="mlInterval"][value="custom"]').checked) {
      saveMLInterval(parseInt(slider.value));
    }
  });
}

function applyLockState(locked, activeValue) {
  const section    = document.getElementById('intervalSection');
  const lockStatus = document.getElementById('lockStatus');
  const lockText   = document.getElementById('lockText');
  const radios     = document.querySelectorAll('input[name="mlInterval"]');

  if (locked) {
    section.classList.add('locked');
    lockStatus.classList.add('visible');
    const display = [2, 5, 10].includes(activeValue)
      ? `${activeValue} min`
      : `${activeValue} min (custom)`;
    lockText.textContent = `Active: ${display} — locked during session`;
    radios.forEach(r => r.disabled = true);
  } else {
    section.classList.remove('locked');
    lockStatus.classList.remove('visible');
    radios.forEach(r => r.disabled = false);
  }
}

function listenForLockChanges() {
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.intervalLocked !== undefined) {
      const locked = changes.intervalLocked.newValue;
      const result = await browser.storage.local.get(['mlInterval']);
      applyLockState(locked, result.mlInterval || 5);
      console.log('[Popup] Lock state changed to:', locked);
    }
  });
}

function saveMLInterval(value) {
  console.log('[Popup] Saving ML interval:', value);
  browser.storage.local.set({ mlInterval: value });
  browser.runtime.sendMessage({ action: 'updateMLInterval', value });
}

// ---- CSV EXPORT ----
function exportToCSV(sessions) {
  if (!sessions || !sessions.length) { alert('No data available to export'); return; }

  const headers = [
    'Session ID', 'Date', 'Duration (minutes)',
    'Total Scroll Distance', 'Total Clicks', 'Scroll Events Count', 'URL'
  ];

  const csvRows = [headers.join(',')];

  for (const s of sessions) {
    const durationMinutes = (s.sessionDuration || 0) / 1000 / 60;
    csvRows.push([
      `"${s.sessionId || ''}"`,
      `"${new Date(s.timestamp || s.savedAt).toISOString()}"`,
      `"${durationMinutes.toFixed(0)}"`,
      `"${s.totalScrollDistance || 0}"`,
      `"${s.totalClicks || 0}"`,
      `"${Array.isArray(s.scrollEvents) ? s.scrollEvents.length : s.scrollEvents || 0}"`,
      `"${s.url || ''}"`
    ].join(','));
  }

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `scroll_data_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
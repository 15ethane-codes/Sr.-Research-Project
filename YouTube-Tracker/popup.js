console.log('Popup opened');

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup DOM loaded');

  const result = await browser.storage.local.get([
    'mlInterval',
    'intervalLocked',
    'intervalConfirmedForSession'
  ]);

  const currentSessionId = await getCurrentSessionId();

  if (!currentSessionId) {
    // No YouTube tab open — always show main view, never show picker
    // Lock state is irrelevant without an active session
    await initMainView();
    return;
  }

  // YouTube tab is open — check if user has confirmed interval for this session
  const confirmedValue = result.intervalConfirmedForSession;
  const alreadyConfirmed =
    confirmedValue === 'pre-session' ||
    confirmedValue === currentSessionId;

  if (alreadyConfirmed) {
    // Confirmed for this session — show locked main view
    await initMainView();
  } else {
    // YouTube open but not yet confirmed for this session — show picker
    showIntervalPicker(result.mlInterval || 5, currentSessionId);
  }
});

// Ask background for the current active session ID
// Returns null if no YouTube tab is open
async function getCurrentSessionId() {
  try {
    const response = await browser.runtime.sendMessage({ action: 'getCurrentSessionId' });
    return response && response.sessionId ? response.sessionId : null;
  } catch (e) {
    return null;
  }
}

// ---- INTERVAL PICKER ----
// Shown at the start of every new session, pre-selected with previous choice
function showIntervalPicker(previousValue, currentSessionId) {
  document.getElementById('onboarding').classList.add('visible');
  document.getElementById('main-view').classList.add('hidden');

  const options = document.querySelectorAll('.onboarding-option');
  const confirmBtn = document.getElementById('confirmInterval');
  const sliderRow = document.getElementById('onboardingSliderRow');
  const slider = document.getElementById('onboardingSlider');
  const sliderValue = document.getElementById('onboardingSliderValue');

  let selectedValue = previousValue;

  // Pre-select the previous choice
  if ([5, 10, 20].includes(previousValue)) {
    const match = document.querySelector(`.onboarding-option[data-value="${previousValue}"]`);
    if (match) match.classList.add('selected');
    sliderRow.style.display = 'none';
  } else {
    // Custom value
    const customOpt = document.querySelector('.onboarding-option[data-value="custom"]');
    if (customOpt) customOpt.classList.add('selected');
    slider.value = previousValue;
    sliderValue.textContent = previousValue;
    sliderRow.style.display = 'flex';
  }

  // Confirm is enabled since we have a pre-selected value
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
    sliderValue.textContent = slider.value;
    selectedValue = parseInt(slider.value);
  });

  confirmBtn.addEventListener('click', async () => {
    if (!selectedValue) return;

    // Lock immediately on confirm regardless of whether a session is active
    // intervalConfirmedForSession tracks which session triggered the picker
    // so we don't re-show it on resume or same session re-open
    await browser.storage.local.set({
      mlInterval: selectedValue,
      intervalLocked: true,
      intervalConfirmedForSession: currentSessionId || 'pre-session'
    });

    browser.runtime.sendMessage({ action: 'updateMLInterval', value: selectedValue });
    console.log('[Picker] Interval confirmed and locked:', selectedValue, 'min, session:', currentSessionId || 'pre-session');

    document.getElementById('onboarding').classList.remove('visible');
    document.getElementById('main-view').classList.remove('hidden');
    await initMainView();
  });
}

// ---- MAIN VIEW ----
async function initMainView() {
  await loadScrollData();
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
  } catch (error) {
    console.error('Error loading data:', error);
    document.getElementById('recentList').innerHTML = '<div class="activity-item">Error loading data</div>';
  }
}

function displayStats(sessions) {
  if (sessions.length === 0) {
    document.getElementById('totalTime').textContent = '0';
    document.getElementById('totalSessions').textContent = '0';
    document.getElementById('avgDuration').textContent = '0m';
    document.getElementById('videoClicks').textContent = '0';
    return;
  }

  const totalDuration = sessions.reduce((sum, s) => sum + (s.sessionDuration || 0), 0);
  const totalClicks = sessions.reduce((sum, s) => sum + (s.totalClicks || 0), 0);
  const totalMinutes = Math.round(totalDuration / 1000 / 60);
  const avgDurationMinutes = Math.round((totalDuration / sessions.length) / 1000 / 60);

  document.getElementById('totalTime').textContent = totalMinutes;
  document.getElementById('totalSessions').textContent = sessions.length;
  document.getElementById('avgDuration').textContent = avgDurationMinutes + 'm';
  document.getElementById('videoClicks').textContent = totalClicks;
}

function groupSessionsIntoVisits(sessions) {
  if (!sessions.length) return [];
  const sorted = [...sessions].sort((a, b) => (a.timestamp || a.savedAt) - (b.timestamp || b.savedAt));
  const visits = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = sorted[i - 1].timestamp || sorted[i - 1].savedAt;
    const currTime = sorted[i].timestamp || sorted[i].savedAt;
    if (currTime - prevTime < 5 * 60 * 1000) current.push(sorted[i]);
    else { visits.push(current); current = [sorted[i]]; }
  }
  visits.push(current);
  return visits;
}

function displayRecentActivity(sessions) {
  const recentList = document.getElementById('recentList');
  if (!sessions.length) {
    recentList.innerHTML = '<div class="activity-item">No data yet. Visit YouTube to start tracking!</div>';
    return;
  }

  const visits = groupSessionsIntoVisits(sessions);
  const recentVisits = visits.slice(-5).reverse();

  const activityHtml = recentVisits.map(visit => {
    const totalDuration = visit.reduce((sum, s) => sum + (s.sessionDuration || 0), 0);
    const totalClicks = visit.reduce((sum, s) => sum + (s.totalClicks || 0), 0);
    const duration = Math.round(totalDuration / 1000 / 60);
    const lastSession = visit[visit.length - 1];
    const timeAgo = formatTimeAgo(lastSession.savedAt || lastSession.timestamp);

    return `<div class="activity-item">
      <strong>${duration}m</strong> browsing • ${totalClicks} clicks • ${timeAgo}
    </div>`;
  }).join('');

  recentList.innerHTML = activityHtml;
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  const hours = Math.round(diff / 3600000);
  const days = Math.round(diff / 86400000);

  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  if (hours < 24) return hours === 1 ? '1h ago' : `${hours}h ago`;
  return days === 1 ? '1d ago' : `${days}d ago`;
}

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

// ---- INTERVAL CONTROLS (main view) ----
async function setupIntervalControls() {
  const radios = document.querySelectorAll('input[name="mlInterval"]');
  const slider = document.getElementById('customSlider');
  const customValue = document.getElementById('customValue');

  const result = await browser.storage.local.get(['mlInterval', 'intervalLocked']);
  const saved = result.mlInterval || 5;
  const locked = result.intervalLocked || false;

  // Set displayed selection
  if ([5, 10, 20].includes(saved)) {
    document.querySelector(`input[name="mlInterval"][value="${saved}"]`).checked = true;
    slider.disabled = true;
  } else {
    document.querySelector('input[name="mlInterval"][value="custom"]').checked = true;
    slider.disabled = false;
    slider.value = saved;
    customValue.textContent = saved;
  }

  applyLockState(locked, saved);

  // Radio change handler — blocked when locked
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

  // Slider handler — blocked when locked
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
  const section = document.getElementById('intervalSection');
  const lockStatus = document.getElementById('lockStatus');
  const lockText = document.getElementById('lockText');
  const radios = document.querySelectorAll('input[name="mlInterval"]');

  if (locked) {
    section.classList.add('locked');
    lockStatus.classList.add('visible');
    const displayValue = [5, 10, 20].includes(activeValue)
      ? `${activeValue} min`
      : `${activeValue} min (custom)`;
    lockText.textContent = `Active: ${displayValue} — locked during session`;
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
  if (!sessions || !sessions.length) {
    alert('No data available to export');
    return;
  }

  const headers = [
    'Session ID', 'Date', 'Duration (minutes)',
    'Total Scroll Distance', 'Total Clicks', 'Scroll Events Count', 'URL'
  ];

  const csvRows = [headers.join(',')];

  for (const s of sessions) {
    const durationMinutes = (s.sessionDuration || 0) / 1000 / 60;
    const row = [
      `"${s.sessionId || ''}"`,
      `"${new Date(s.timestamp || s.savedAt).toISOString()}"`,
      `"${durationMinutes.toFixed(0)}"`,
      `"${s.totalScrollDistance || 0}"`,
      `"${s.totalClicks || 0}"`,
      `"${Array.isArray(s.scrollEvents) ? s.scrollEvents.length : s.scrollEvents || 0}"`,
      `"${s.url || ''}"`
    ];
    csvRows.push(row.join(','));
  }

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scroll_data_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
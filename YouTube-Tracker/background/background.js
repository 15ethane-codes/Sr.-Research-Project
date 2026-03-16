// Version 1.6.0
console.log('Background script loaded and ready');

let nudgeLevel = 0;
let nudgeCount = 0;
let lastNudgeTime = 0;
const NUDGE_COOLDOWN = 5 * 60 * 1000;

// SESSION MANAGEMENT
// tabSessions:     tabId -> sessionId (string)
// latestSnapshots: sessionId -> last full saveScrollData payload
// pausedSession:   global { sessionId, pauseTimestamp, snapshot } — tab-ID-independent
const tabSessions = {};
const latestSnapshots = {};
let pausedSession = null;
const SESSION_TIMEOUT = 10 * 60 * 1000;

const sessionRuleStates = {};
const mlWindowState = {};

let mlCalculationInterval = 0.5;
const nextAllowedAnalyze = {};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received from content script:', message.action);

  // SESSION HANDSHAKE
  if (message.action === 'requestSessionId') {
    const tabId = sender.tab ? sender.tab.id : null;
    const now = Date.now();
    let sessionId;
    let snapshot = null;

    if (
      pausedSession &&
      pausedSession.sessionId &&
      (now - pausedSession.pauseTimestamp) < SESSION_TIMEOUT
    ) {
      // Resume — pull snapshot from latestSnapshots (reliable) not from pausedSession.snapshot
      sessionId = pausedSession.sessionId;
      snapshot = latestSnapshots[sessionId] || pausedSession.snapshot || null;
      console.log('Resuming paused session for tab', tabId, ':', sessionId,
        '(paused', Math.round((now - pausedSession.pauseTimestamp) / 1000) + 's ago)',
        snapshot ? '— snapshot scrollDist: ' + (snapshot.totalScrollDistance || 0) : '— no snapshot');
      pausedSession = null; // consumed
    } else {
      sessionId = 'session_' + now + '_' + Math.random().toString(36).substr(2, 9);
      sessionRuleStates[sessionId] = false;
      delete mlWindowState[sessionId];
      console.log('New session created for tab', tabId, ':', sessionId);
    }

    tabSessions[tabId] = sessionId;
    sendResponse({ sessionId, snapshot });
    return true;
  }

  // TAB CLOSING — content script fires in beforeunload
  // Snapshot already stored in latestSnapshots from last saveScrollData — no need to rely on message payload
  if (message.action === 'youtubeClosed') {
    const tabId = sender.tab ? sender.tab.id : null;
    const sessionId = tabId ? tabSessions[tabId] : null;
    if (sessionId) {
      pausedSession = {
        sessionId,
        pauseTimestamp: Date.now(),
        snapshot: latestSnapshots[sessionId] || null
      };
      console.log('Session paused globally:', sessionId, 'from tab', tabId,
        '— snapshot scrollDist:', pausedSession.snapshot ? pausedSession.snapshot.totalScrollDistance : 'none');
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'saveScrollData') {
    const sessionId = message.data.sessionId;

    // Store latest snapshot keyed by sessionId — this is what resume restores from
    if (sessionId) latestSnapshots[sessionId] = message.data;

    console.log('Saving scroll data:', {
      duration: Math.round(message.data.sessionDuration / 1000) + 's',
      totalClicks: message.data.totalClicks,
      scrolls: message.data.scrollEvents?.length || 0,
      totalScrollDist: message.data.totalScrollDistance
    });

    const now = Date.now();
    const nextTime = nextAllowedAnalyze[sessionId] || 0;
    const secondsUntilNext = ((nextTime - now) / 1000).toFixed(1);
    const w = mlWindowState[sessionId];

    // Always log current observable state so you can track progress toward thresholds
    console.log(
      `[State] ...${sessionId.slice(-8)} | ` +
      `${formatDuration(message.data.sessionDuration)} | ` +
      `scrollDist: ${Math.round(message.data.totalScrollDistance || 0)} | ` +
      `clicks: ${message.data.totalClicks || 0} | ` +
      `context: ${message.data.currentContext} | ` +
      `nextAnalysis: ${now >= nextTime ? 'NOW' : secondsUntilNext + 's'}`
    );

    if (now >= nextTime) {
      analyzeSession(message.data);
      nextAllowedAnalyze[sessionId] = now + mlCalculationInterval * 60 * 1000;
    } else {
      // analysis on cooldown — state already logged above
    }

    saveSessionData(message.data);
    sendResponse({ success: true, saved: true });
    return false;
  }

  else if (message.action === 'getScrollData') {
    console.log('Fetching stored data');
    getStoredData().then(data => {
      console.log('Returning', data.length, 'sessions');
      sendResponse({ data: data });
    });
    return true;
  }

  else if (message.action === 'updateMLInterval') {
    const newInterval = parseFloat(message.value);
    console.log('Received new calculation interval from popup (minutes):', newInterval);
    mlCalculationInterval = newInterval;
    console.log('Updated ML calculation interval (ms):', mlCalculationInterval * 60 * 1000);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === 'contentReady' && sender.tab) {
    console.log('Tab ready for nudges:', sender.tab.id);
    sendResponse({ success: true });
    return false;
  }

  // Content script calls this when user clicks a suggestion button
  if (message.action === 'clearActiveNudge') {
    browser.storage.local.remove('activeNudge').then(() => {
      console.log('[Nudge] Active nudge cleared from storage');
      sendResponse({ success: true });
    });
    return true;
  }

  // Close the sender tab — window.close() does not work for user-opened tabs in Firefox
  if (message.action === 'closeTab') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      console.log('[Nudge] Closing tab', tabId, 'on user request');
      browser.tabs.remove(tabId).catch(err => console.warn('Could not close tab:', err));
    }
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// When any YouTube tab becomes active, check if a persistent nudge should be shown
browser.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    if (!tab.url || !tab.url.includes('youtube.com')) return;
    const result = await browser.storage.local.get(['activeNudge']);
    if (result.activeNudge) {
      console.log('[Nudge] Tab activated, re-showing persistent nudge on tab', activeInfo.tabId);
      browser.tabs.sendMessage(activeInfo.tabId, {
        action: 'showSuggestionPrompt',
        ...result.activeNudge
      }).catch(err => console.log('Could not re-show nudge on tab', activeInfo.tabId, err));
    }
  } catch (e) {
    // Tab may not be ready yet — content script will check on load
  }
});

// Tab closed by browser — safety net if beforeunload didn't fire
browser.tabs.onRemoved.addListener(async (tabId) => {
  const sessionId = tabSessions[tabId];
  if (sessionId) {
    if (!pausedSession || pausedSession.sessionId !== sessionId) {
      pausedSession = {
        sessionId,
        pauseTimestamp: Date.now(),
        snapshot: latestSnapshots[sessionId] || null
      };
      console.log('Tab removed, session paused globally:', sessionId, 'from tab', tabId);
    }
    delete tabSessions[tabId];
  }

  const tabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
  if (tabs.length === 0) {
    console.log('All YouTube tabs closed');
  }
});

// Save session data to storage
async function saveSessionData(sessionData) {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    const sessions = result.scrollSessions || [];
    const existingIndex = sessions.findIndex(s => s.sessionId === sessionData.sessionId);

    if (existingIndex >= 0) {
      sessions[existingIndex] = { ...sessionData, savedAt: Date.now() };
      console.log('Replaced session:', sessionData.sessionId, 'Total clicks:', sessionData.totalClicks);
    } else {
      sessions.push({ ...sessionData, savedAt: Date.now() });
      console.log('Added new session:', sessionData.sessionId);
    }

    const recentSessions = sessions.slice(-100);
    await browser.storage.local.set({ scrollSessions: recentSessions });
    console.log('Total unique sessions in storage:', recentSessions.length);
  } catch (error) {
    console.error('Error saving session data:', error);
  }
}

async function getStoredData() {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    return result.scrollSessions || [];
  } catch (error) {
    console.error('Error retrieving data:', error);
    return [];
  }
}

browser.runtime.onInstalled.addListener(() => cleanupOldData());
async function cleanupOldData() {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    const sessions = result.scrollSessions || [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter(s => s.savedAt > thirtyDaysAgo);
    await browser.storage.local.set({ scrollSessions: recentSessions });
    console.log(`Cleaned up old data. Kept ${recentSessions.length} sessions.`);
  } catch (error) {
    console.error('Error cleaning up data:', error);
  }
}

// ----------------- ANALYSIS -----------------
function formatDuration(durationMs) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function predictDoomscrollProbability(features) {
  return Math.min(1, features.scrollIntensity / 5000 + features.engagementScore / 2);
}

function analyzeSession(sessionData) {
  if (!mlWindowState[sessionData.sessionId]) {
    mlWindowState[sessionData.sessionId] = {
      scrollDistance: 0,
      videoClicks: 0,
      shortsClicks: 0,
      durationMs: 0,
      lastReset: Date.now()
    };
  }

  const w = mlWindowState[sessionData.sessionId];
  const now = Date.now();
  const rawDurationMs = sessionData.sessionDuration;
  const rawMinutes = rawDurationMs / 1000 / 60;

  const GRACE_PERIOD_MAIN = 2;
  const GRACE_PERIOD_SHORTS = 0.5;
  const currentGrace = sessionData.currentContext === 'shorts_feed' ? GRACE_PERIOD_SHORTS : GRACE_PERIOD_MAIN;

  // Grace period uses total session duration (includes resumed time),
  // so a resumed session that was already 2+ minutes old skips grace immediately
  if (rawMinutes < currentGrace) {
    console.log(
      `[Analysis] Grace period (${rawMinutes.toFixed(2)}m < ${currentGrace}m) | ` +
      `Session: ...${sessionData.sessionId.slice(-8)} | ` +
      `Context: ${sessionData.currentContext} | ` +
      `totalScrollDist: ${Math.round(sessionData.totalScrollDistance || 0)} | ` +
      `clicks: ${sessionData.totalClicks || 0}`
    );
    return false;
  }

  if (sessionData.currentContext === 'watching_video') {
    const decayFactor = 0.75;
    w.scrollDistance *= decayFactor;
    w.videoClicks *= decayFactor;
    w.shortsClicks *= decayFactor;
    w.durationMs *= decayFactor;
    sessionRuleStates[sessionData.sessionId] = false;
  } else {
    if (w.lastTotalScroll === undefined) w.lastTotalScroll = sessionData.totalScrollDistance || 0;
    if (w.lastVideoClicks === undefined) w.lastVideoClicks = sessionData.videoClicks || 0;
    if (w.lastShortsClicks === undefined) w.lastShortsClicks = sessionData.shortsClicks || 0;

    const scrollDelta = (sessionData.totalScrollDistance || 0) - w.lastTotalScroll;
    const videoDelta = (sessionData.videoClicks || 0) - w.lastVideoClicks;
    const shortsDelta = (sessionData.shortsClicks || 0) - w.lastShortsClicks;

    w.lastTotalScroll = sessionData.totalScrollDistance || 0;
    w.lastVideoClicks = sessionData.videoClicks || 0;
    w.lastShortsClicks = sessionData.shortsClicks || 0;

    w.scrollDistance += Math.max(0, scrollDelta);
    w.videoClicks += Math.max(0, videoDelta);
    w.shortsClicks += Math.max(0, shortsDelta);
    w.durationMs += rawDurationMs;

    if (now - w.lastReset > 30 * 1000) {
      w.scrollDistance *= 0.7;
      w.videoClicks *= 0.7;
      w.shortsClicks *= 0.7;
      w.durationMs *= 0.7;
      w.lastReset = now;
    }
  }

  const rollingMinutes = w.durationMs / 1000 / 60;
  const totalClicks = w.videoClicks + w.shortsClicks;
  const scrollIntensity = rollingMinutes > 0 ? w.scrollDistance / rollingMinutes : 0;
  const clickRate = rollingMinutes > 0 ? totalClicks / rollingMinutes : 0;
  const engagementScore = w.scrollDistance > 0 ? (totalClicks * 1000 / w.scrollDistance) : 0;
  const mlFeatures = { scrollIntensity, engagementScore, durationMinutes: rollingMinutes };
  const doomProb = predictDoomscrollProbability(mlFeatures);

  let bayesDoom = false;
  if (doomProb < 0.65) {
    const pScroll = scrollIntensity > 2000 ? 0.7 : 0.3;
    const pDuration = rawMinutes > 20 ? 0.7 : 0.3;
    const pEngagement = engagementScore < 0.5 ? 0.6 : 0.4;
    bayesDoom = ((pScroll + pDuration + pEngagement) / 3) >= 0.6;
  }

  const signals = {
    longDuration:   rawMinutes > 7.5,
    highScrolling:  w.scrollDistance > 10000,
    lowEngagement:  engagementScore < 0.5,
    fastScrolling:  scrollIntensity > 2000,
    lowClickRate:   clickRate < 0.3 && rawMinutes > 7.5,
    shortsOverload: sessionData.currentContext === 'shorts_feed' && w.shortsClicks > 18
  };

  const signalCount = Object.values(signals).filter(Boolean).length;
  const prevRuleState = sessionRuleStates[sessionData.sessionId] || false;
  let ruleBased = prevRuleState ? signalCount >= 2 : signalCount >= 3;
  if (sessionData.currentContext === 'watching_video') ruleBased = false;
  sessionRuleStates[sessionData.sessionId] = ruleBased;

  const mlBased = doomProb >= 0.65;
  const logicArray = [ruleBased, mlBased, bayesDoom];
  const trueCount = logicArray.filter(Boolean).length;
  const isDoomscrolling = trueCount >= 2;

  // ---- ML PROBABILITY LOG ----
  console.log(
    `[Analysis] Session: ...${sessionData.sessionId.slice(-8)} | ` +
    `Context: ${sessionData.currentContext} | ` +
    `Duration: ${formatDuration(rawDurationMs)} | ` +
    `ScrollDist: ${Math.round(w.scrollDistance)} | ` +
    `ScrollIntensity: ${scrollIntensity.toFixed(1)}/min | ` +
    `ClickRate: ${clickRate.toFixed(2)}/min | ` +
    `Engagement: ${engagementScore.toFixed(3)}`
  );
  console.log(
    `[Analysis] doomProb: ${doomProb.toFixed(3)} | ` +
    `ruleBased: ${ruleBased} | mlBased: ${mlBased} | bayesDoom: ${bayesDoom} | ` +
    `=> isDoomscrolling: ${isDoomscrolling} (${trueCount}/3)`
  );
  console.log(
    `[Signals]  longDuration: ${signals.longDuration} | ` +
    `highScrolling: ${signals.highScrolling} | ` +
    `lowEngagement: ${signals.lowEngagement} | ` +
    `fastScrolling: ${signals.fastScrolling} | ` +
    `lowClickRate: ${signals.lowClickRate} | ` +
    `shortsOverload: ${signals.shortsOverload} | ` +
    `count: ${signalCount}/6`
  );

  const canNudge = isDoomscrolling && sessionData.currentContext !== 'watching_video';
  if (canNudge) triggerNudge(sessionData, signals, rawDurationMs);

  return isDoomscrolling;
}

// ----------------- NUDGE FUNCTIONS -----------------
function triggerNudge(sessionData, signals, durationMs) {
  const now = Date.now();
  if (now - lastNudgeTime < NUDGE_COOLDOWN) return;

  lastNudgeTime = now;
  nudgeCount++;

  if (durationMs >= 25 * 60 * 1000 && nudgeCount >= 2) {
    nudgeLevel = 3;
    activateScrollResistance(sessionData, durationMs);
  } else if (durationMs >= 20 * 60 * 1000 || nudgeCount >= 2) {
    nudgeLevel = 2;
    showSuggestionNudge(sessionData, signals, durationMs);
  } else {
    nudgeLevel = 1;
    showAwarenessNudge(sessionData, signals, durationMs);
  }

  logNudge(sessionData.sessionId, nudgeLevel, nudgeCount, durationMs);
}

function showAwarenessNudge(sessionData, signals, durationMs) {
  let message = '';
  let nudgeType = '';

  if (signals.shortsOverload) {
    nudgeType = 'shorts_awareness';
    message = `You've watched ${Math.round(sessionData.shortsClicks)} Shorts in ${formatDuration(durationMs)}. Still enjoying?`;
  } else if (signals.lowEngagement) {
    nudgeType = 'low_engagement';
    message = `${formatDuration(durationMs)} of scrolling. Finding what you need?`;
  } else {
    nudgeType = 'time_awareness';
    message = `You've been on YouTube for ${formatDuration(durationMs)}.`;
  }

  browser.notifications.create({ type: 'basic', title: 'YouTube Time Check', message, priority: 1 });
  sendToActiveTab({ action: 'showAwarenessBanner', message, nudgeType });
}

async function showSuggestionNudge(sessionData, signals, durationMs) {
  const suggestions = [];
  let nudgeType = '';

  if (sessionData.currentContext === 'shorts_feed') {
    nudgeType = 'shorts_redirect';
    suggestions.push('Watch a full video instead?');
    suggestions.push('Check your subscriptions');
    suggestions.push('Take a 5-minute break');
  } else if (signals.lowEngagement) {
    nudgeType = 'search_prompt';
    suggestions.push('Search for something specific?');
    suggestions.push('Browse your Watch Later');
    suggestions.push('Close YouTube for now');
  } else {
    nudgeType = 'general_break';
    suggestions.push('Take a short break');
    suggestions.push('Find something specific to watch');
    suggestions.push('Switch to a different activity');
  }

  // Persist nudge so all tabs (and reloads) show it until user clicks a choice
  const nudgeData = { suggestions, duration: durationMs, nudgeType };
  await browser.storage.local.set({ activeNudge: nudgeData });
  console.log('[Nudge] Active nudge saved to storage:', nudgeType);

  // Broadcast to every open YouTube tab, not just the active one
  sendToAllYouTubeTabs({ action: 'showSuggestionPrompt', suggestions, duration: durationMs, nudgeType });
}

function activateScrollResistance(sessionData, durationMs) {
  console.log('LEVEL 3 TRIGGERED', formatDuration(durationMs));
  sendToActiveTab({ action: 'activateScrollResistance', duration: durationMs, context: sessionData.currentContext });
}

function sendToActiveTab(message) {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (tabs[0] && tabs[0].url.includes('youtube.com')) {
      browser.tabs.sendMessage(tabs[0].id, message).catch(err => console.log('Could not send message to tab:', err));
    }
  });
}

// Send a message to every open YouTube tab
function sendToAllYouTubeTabs(message) {
  browser.tabs.query({ url: '*://*.youtube.com/*' }).then(tabs => {
    tabs.forEach(tab => {
      browser.tabs.sendMessage(tab.id, message).catch(err =>
        console.log('Could not send to tab', tab.id, ':', err)
      );
    });
    console.log('[Nudge] Broadcast to', tabs.length, 'YouTube tab(s)');
  });
}

async function logNudge(sessionId, nudgeLevel, nudgeCount, durationMs) {
  try {
    const result = await browser.storage.local.get(['nudgeHistory']);
    const history = result.nudgeHistory || [];
    history.push({ timestamp: Date.now(), sessionId, nudgeLevel, nudgeCount, sessionDuration: durationMs });
    await browser.storage.local.set({ nudgeHistory: history.slice(-100) });
    console.log('Nudge logged - Level:', nudgeLevel, 'Count:', nudgeCount);
  } catch (error) {
    console.error('Error logging nudge:', error);
  }
}

// Expose for testing
window.testNudge = (level = 1) => {
  let durationMs;
  const nudgeCountBackup = nudgeCount;

  switch (level) {
    case 1: durationMs = 5 * 60 * 1000;  nudgeCount = 0; break;
    case 2: durationMs = 20 * 60 * 1000; nudgeCount = 1; break;
    case 3: durationMs = 30 * 60 * 1000; nudgeCount = 2; break;
    default: durationMs = 5 * 60 * 1000; nudgeCount = 0;
  }

  const fakeSession = {
    sessionId: 'test-session',
    currentContext: 'normal',
    totalScrollDistance: 10000,
    totalClicks: 2,
    videoClicks: 2,
    shortsClicks: 0,
    sessionDuration: durationMs
  };

  const fakeSignals = {
    longDuration: true,
    highScrolling: true,
    lowEngagement: false,
    fastScrolling: true,
    lowClickRate: true,
    shortsOverload: false
  };

  triggerNudge(fakeSession, fakeSignals, durationMs);
  console.log(`Test nudge triggered for level ${level} with duration ${formatDuration(durationMs)}`);
  nudgeCount = nudgeCountBackup;
};
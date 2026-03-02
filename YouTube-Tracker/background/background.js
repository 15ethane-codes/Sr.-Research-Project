//Version 1.4.4
console.log('Background script loaded and ready');

let nudgeLevel = 0;
let nudgeCount = 0;
let lastNudgeTime = 0;
const NUDGE_COOLDOWN = 5 * 60 * 1000; // 5 minutes between nudges

// Keep track of rule-based state per session
const sessionRuleStates = {};
// Track rolling accumulation for ML features per session
const mlWindowState = {};

// Default ML interval (minutes) if nothing is set by the user
let mlCalculationInterval = 0.5; // 30s default for testing
let nextAllowedAnalyze = {}; // per session next allowed timestamp

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received from content script:', message.action);

  if (message.action === 'saveScrollData') {
    console.log('Saving scroll data:', {
      duration: Math.round(message.data.sessionDuration / 1000) + 's',
      totalClicks: message.data.totalClicks,
      scrolls: message.data.scrollEvents?.length || 0
    });

    const sessionId = message.data.sessionId;
    const now = Date.now();
    const nextTime = nextAllowedAnalyze[sessionId] || 0;

    const effectiveInterval = mlCalculationInterval;

    if (now >= nextTime) {
      analyzeSession(message.data);
      nextAllowedAnalyze[sessionId] = now + effectiveInterval * 60 * 1000;
    } else {
      console.log(`Skipping analyzeSession for ${sessionId}, next allowed in ${((nextTime - now)/1000).toFixed(3)}s`);
    }

    saveSessionData(message.data);

    sendResponse({success: true, saved: true});
    return false;
  } else if (message.action === 'getScrollData') {
    console.log('Fetching stored data');
    getStoredData().then(data => {
      console.log('Returning', data.length, 'sessions');
      sendResponse({data: data});
    });
    return true;
  } else if (message.action === 'updateMLInterval') {
    const newInterval = parseFloat(message.value);
    console.log('Received new calculation interval from popup (minutes):', newInterval);
    mlCalculationInterval = newInterval;
    console.log('Updated ML calculation interval (ms):', mlCalculationInterval*60*1000);
    sendResponse({success: true});
    return false;
  }

  return false;
});

// Save session data
async function saveSessionData(sessionData) {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    const sessions = result.scrollSessions || [];

    const existingIndex = sessions.findIndex(s => s.sessionId === sessionData.sessionId);

    if (existingIndex >= 0) {
      sessions[existingIndex] = {...sessionData, savedAt: Date.now()};
      console.log('Replaced session:', sessionData.sessionId, 'Total clicks:', sessionData.totalClicks);
    } else {
      sessions.push({...sessionData, savedAt: Date.now()});
      console.log('Added new session:', sessionData.sessionId);
    }

    const recentSessions = sessions.slice(-100);
    await browser.storage.local.set({scrollSessions: recentSessions});
    console.log('Total unique sessions in storage:', recentSessions.length);
  } catch (error) {
    console.error('Error saving session data:', error);
  }
}

// Get stored sessions
async function getStoredData() {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    return result.scrollSessions || [];
  } catch (error) {
    console.error('Error retrieving data:', error);
    return [];
  }
}

// Cleanup old data
browser.runtime.onInstalled.addListener(() => cleanupOldData());
async function cleanupOldData() {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    const sessions = result.scrollSessions || [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter(s => s.savedAt > thirtyDaysAgo);
    await browser.storage.local.set({scrollSessions: recentSessions});
    console.log(`Cleaned up old data. Kept ${recentSessions.length} sessions.`);
  } catch (error) {
    console.error('Error cleaning up data:', error);
  }
}

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

  const currentGrace = sessionData.currentContext === 'shorts_feed'
    ? GRACE_PERIOD_SHORTS
    : GRACE_PERIOD_MAIN;

  console.log(`Current context: ${sessionData.currentContext}, rawMinutes: ${rawMinutes.toFixed(2)}, grace: ${currentGrace} min`);

  if (rawMinutes < currentGrace) {
    console.log(`Within grace period (${currentGrace} min), skipping nudge.`);
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

    // SAFE DELTA ACCUMULATION

    if (w.lastTotalScroll === undefined) {
      w.lastTotalScroll = sessionData.totalScrollDistance || 0;
    }

    if (w.lastVideoClicks === undefined) {
      w.lastVideoClicks = sessionData.videoClicks || 0;
    }

    if (w.lastShortsClicks === undefined) {
      w.lastShortsClicks = sessionData.shortsClicks || 0;
    }

    const currentTotalScroll = sessionData.totalScrollDistance || 0;
    const currentVideoClicks = sessionData.videoClicks || 0;
    const currentShortsClicks = sessionData.shortsClicks || 0;

    const scrollDelta = currentTotalScroll - w.lastTotalScroll;
    const videoDelta = currentVideoClicks - w.lastVideoClicks;
    const shortsDelta = currentShortsClicks - w.lastShortsClicks;

    w.lastTotalScroll = currentTotalScroll;
    w.lastVideoClicks = currentVideoClicks;
    w.lastShortsClicks = currentShortsClicks;

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
  let doomProb = predictDoomscrollProbability(mlFeatures);
  console.log('ML doomscroll probability:', doomProb.toFixed(3));

  let bayesDoom = false;
  if (doomProb < 0.65) {
    const pScroll = scrollIntensity > 2000 ? 0.7 : 0.3;
    const pDuration = rawMinutes > 20 ? 0.7 : 0.3;
    const pEngagement = engagementScore < 0.5 ? 0.6 : 0.4;
    bayesDoom = ((pScroll + pDuration + pEngagement)/3) >= 0.6;
  }

  const signals = {
    longDuration: rawMinutes > 7.5,
    highScrolling: w.scrollDistance > 10000,
    lowEngagement: engagementScore < 0.5,
    fastScrolling: scrollIntensity > 2000,
    lowClickRate: clickRate < 0.3 && rawMinutes > 7.5,
    shortsOverload: sessionData.currentContext === 'shorts_feed' && w.shortsClicks > 18
  };

  const signalCount = Object.values(signals).filter(Boolean).length;

  const prevRuleState = sessionRuleStates[sessionData.sessionId] || false;
  let ruleBased = prevRuleState ? signalCount >= 2 : signalCount >= 3;
  if (sessionData.currentContext === 'watching_video') ruleBased = false;
  sessionRuleStates[sessionData.sessionId] = ruleBased;

  let mlBased = doomProb >= 0.65;

  const logicArray = [ruleBased, mlBased, bayesDoom];
  const trueCount = logicArray.filter(Boolean).length;
  const isDoomscrolling = trueCount >= 2;

  console.log('Hybrid decision (2-of-3 rule):', {
    ruleBased,
    ml: mlBased,
    bayesian: bayesDoom,
    mlProbability: doomProb.toFixed(3),
    final: isDoomscrolling
  });

  const canNudge = isDoomscrolling && sessionData.currentContext !== 'watching_video';

  if (canNudge) {
    console.log('Doomscrolling detected and context OK! Triggering nudge...');
    triggerNudge(sessionData, signals, rawDurationMs);
  }

  return isDoomscrolling;
}

// NUDGE FUNCTIONS
function triggerNudge(sessionData, signals, durationMs) {
  const now = Date.now();
  if (now - lastNudgeTime < NUDGE_COOLDOWN) {
    console.log('Nudge on cooldown, skipping...');
    return;
  }

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

// AWARENESS & SUGGESTION NUDGES 
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

function showSuggestionNudge(sessionData, signals, durationMs) {
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

  sendToActiveTab({ action: 'showSuggestionPrompt', suggestions, duration: durationMs, nudgeType });
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

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'contentReady' && sender.tab) {
    console.log('Tab ready for nudges:', sender.tab.id);
  }
});

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
  let nudgeCountBackup = nudgeCount;

  switch(level) {
    case 1:
      durationMs = 5 * 60 * 1000; // 5 minutes
      nudgeCount = 0;
      break;
    case 2:
      durationMs = 20 * 60 * 1000; // 20 minutes
      nudgeCount = 1;
      break;
    case 3:
      durationMs = 30 * 60 * 1000; // 30 minutes
      nudgeCount = 2;
      break;
    default:
      durationMs = 5 * 60 * 1000;
      nudgeCount = 0;
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

  // pass durationMs directly in milliseconds
  triggerNudge(fakeSession, fakeSignals, durationMs);

  console.log(`Test nudge triggered for level ${level} with duration ${formatDuration(durationMs)}`);

  nudgeCount = nudgeCountBackup;
};
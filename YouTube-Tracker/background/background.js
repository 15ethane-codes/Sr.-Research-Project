//Version 1.3.5
console.log('Background script loaded and ready');

let nudgeLevel = 0;
let nudgeCount = 0;
let lastNudgeTime = 0;
const NUDGE_COOLDOWN = 5 * 60 * 1000; // 5 minutes between nudges

// Keep track of rule-based state per session
const sessionRuleStates = {};
// Track rolling accumulation for ML features per session
const mlWindowState = {};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received from content script:', message.action);

  if (message.action === 'saveScrollData') {
    console.log('Saving scroll data:', {
      duration: Math.round(message.data.sessionDuration / 1000) + 's',
      totalClicks: message.data.totalClicks,
      scrolls: message.data.scrollEvents?.length || 0
    });

    saveSessionData(message.data);
    analyzeSession(message.data);

    sendResponse({success: true, saved: true});
    return false;
  } else if (message.action === 'getScrollData') {
    console.log('Fetching stored data');
    getStoredData().then(data => {
      console.log('Returning', data.length, 'sessions');
      sendResponse({data: data});
    });
    return true;
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

// Enhanced doomscrolling detection with rolling window
function analyzeSession(sessionData) {
  // Initialize rolling state for session if needed
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

  // Slow decay if watching a normal video (Version 1.3.0-1.3.5))
  if (sessionData.currentContext === 'watching_video') {
    const decayFactor = 0.80; // stronger decay per update
    w.scrollDistance *= decayFactor;
    w.videoClicks *= decayFactor;
    w.shortsClicks *= decayFactor;
    w.durationMs *= decayFactor;

    // Reset rule-based signals while watching video
    sessionRuleStates[sessionData.sessionId] = false;
  } else {
    // Update rolling totals normally
    w.scrollDistance += sessionData.totalScrollDistance;
    w.videoClicks += sessionData.videoClicks || 0;
    w.shortsClicks += sessionData.shortsClicks || 0;
    w.durationMs += sessionData.sessionDuration;

    // Rolling reset every 30s to avoid over-accumulation
    if (now - w.lastReset > 30 * 1000) {
      w.scrollDistance *= 0.7; // decay 30%
      w.videoClicks *= 0.7;
      w.shortsClicks *= 0.7;
      w.durationMs *= 0.7;
      w.lastReset = now;
    }
  }

  const durationMinutes = w.durationMs / 1000 / 60;
  const totalClicks = w.videoClicks + w.shortsClicks;
  const scrollIntensity = durationMinutes > 0 ? w.scrollDistance / durationMinutes : 0;
  const clickRate = durationMinutes > 0 ? totalClicks / durationMinutes : 0;
  const engagementScore = w.scrollDistance > 0 ? (totalClicks * 1000 / w.scrollDistance) : 0;

  const mlFeatures = {
    scrollIntensity: scrollIntensity,
    engagementScore: engagementScore,
    durationMinutes: durationMinutes
  };

  let doomProb = predictDoomscrollProbability(mlFeatures);
  console.log('ML doomscroll probability:', doomProb.toFixed(3));

  let bayesDoom = false; // Needs some adjustment
  if (doomProb < 0.65) {
    const pScroll = scrollIntensity > 2000 ? 0.7 : 0.3;
    const pDuration = durationMinutes > 20 ? 0.7 : 0.3;
    const pEngagement = engagementScore < 0.5 ? 0.6 : 0.4;

    const posterior = (pScroll + pDuration + pEngagement) / 3;
    bayesDoom = posterior >= 0.6;
    console.log('Bayesian fallback:', posterior);
  }

  // Signals for rule-based (rolling window aware)
  const signals = {
    longDuration: durationMinutes > 7.5,
    highScrolling: w.scrollDistance > 10000,
    lowEngagement: engagementScore < 0.5,
    fastScrolling: scrollIntensity > 2000,
    lowClickRate: clickRate < 0.3 && durationMinutes > 7.5,
    shortsOverload: sessionData.currentContext === 'shorts_feed' && w.shortsClicks > 18
  };
  const signalCount = Object.values(signals).filter(Boolean).length;

  // Rule-based decision
  const prevRuleState = sessionRuleStates[sessionData.sessionId] || false;
  let ruleBased = prevRuleState ? signalCount >= 2 : signalCount >= 3;
  if (sessionData.currentContext === 'watching_video') {
    ruleBased = false; // reset while watching video
  }
  sessionRuleStates[sessionData.sessionId] = ruleBased;

  // ML-based decision
  let mlBased = doomProb >= 0.65;

  // Stronger ML decay while watching a video
  if (sessionData.currentContext === 'watching_video') {
    const decayFactor = 0.85;
    const decayedFeatures = {
      scrollIntensity: scrollIntensity * decayFactor,
      engagementScore: engagementScore * decayFactor,
      durationMinutes: durationMinutes * decayFactor
    };
    doomProb = predictDoomscrollProbability(decayedFeatures);
    mlBased = doomProb >= 0.65;
    console.log('ML doom probability after decay:', doomProb.toFixed(3));
  }

  // Final decision: at least 2 of 3 logics must be true
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

  const GRACE_PERIOD_MAIN = 2; // minutes
  const GRACE_PERIOD_SHORTS = 0.5; // 30 seconds
  const currentGrace = sessionData.currentContext === 'shorts_feed' 
                      ? GRACE_PERIOD_SHORTS 
                      : GRACE_PERIOD_MAIN;

  if (durationMinutes < currentGrace) {
    console.log(`Within grace period (${currentGrace} min), skipping nudge.`);
    return false;
  }

  const canNudge = isDoomscrolling && sessionData.currentContext !== 'watching_video';
  if (canNudge) {
    console.log('Doomscrolling detected and context OK! Triggering nudge...');
    triggerNudge(sessionData, signals, durationMinutes);
  } else if (isDoomscrolling && sessionData.currentContext === 'watching_video') {
    console.log('Doomscrolling detected but user is watching video, skipping nudge.');
  }

  return isDoomscrolling;
}


// Nudge functions (Version 1.2.0)
function triggerNudge(sessionData, signals, durationMinutes) {
  const now = Date.now();
  if (now - lastNudgeTime < NUDGE_COOLDOWN) {
    console.log('Nudge on cooldown, skipping...');
    return;
  }

  lastNudgeTime = now;
  nudgeCount++;

  if (durationMinutes >= 25 && nudgeCount >= 2) {
    nudgeLevel = 3;
    activateScrollResistance(sessionData, durationMinutes);
  } else if (durationMinutes >= 20 || nudgeCount >= 2) {
    nudgeLevel = 2;
    showSuggestionNudge(sessionData, signals, durationMinutes);
  } else {
    nudgeLevel = 1;
    showAwarenessNudge(sessionData, signals, durationMinutes);
  }

  logNudge(sessionData.sessionId, nudgeLevel, nudgeCount, durationMinutes);
}

function showAwarenessNudge(sessionData, signals, durationMinutes) {
  let message = '';
  let nudgeType = '';
  
  if (signals.shortsOverload) {
    nudgeType = 'shorts_awareness';
    message = `You've watched ${Math.round(sessionData.shortsClicks)} Shorts in ${Math.round(durationMinutes)} minutes. Still enjoying?`;
  } else if (signals.lowEngagement) {
    nudgeType = 'low_engagement';
    message = `${Math.round(durationMinutes)} minutes of scrolling. Finding what you need?`;
  } else {
    nudgeType = 'time_awareness';
    message = `You've been on YouTube for ${Math.round(durationMinutes)} minutes.`;
  }
  
  browser.notifications.create({
    type: 'basic',
    title: 'YouTube Time Check',
    message: message,
    priority: 1
  });
  
  sendToActiveTab({
    action: 'showAwarenessBanner',
    message: message,
    nudgeType: nudgeType
  });
}

function showSuggestionNudge(sessionData, signals, durationMinutes) {
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
  
  sendToActiveTab({
    action: 'showSuggestionPrompt',
    suggestions: suggestions,
    duration: Math.round(durationMinutes),
    nudgeType: nudgeType
  });
}

function activateScrollResistance(sessionData, durationMinutes) {
  console.log('LEVEL 3 TRIGGERED', durationMinutes);

  sendToActiveTab({
    action: 'activateScrollResistance',
    duration: Math.round(durationMinutes),
    context: sessionData.currentContext
  });
}

function sendToActiveTab(message) {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (tabs[0] && tabs[0].url.includes('youtube.com')) {
      browser.tabs.sendMessage(tabs[0].id, message)
        .catch(err => console.log('Could not send message to tab:', err));
    }
  });
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'contentReady' && sender.tab) {
    console.log('Tab ready for nudges:', sender.tab.id);
  }
});

async function logNudge(sessionId, nudgeLevel, nudgeCount, durationMinutes) {
  try {
    const result = await browser.storage.local.get(['nudgeHistory']);
    const history = result.nudgeHistory || [];

    history.push({
      timestamp: Date.now(),
      sessionId,
      nudgeLevel,
      nudgeCount,
      sessionDuration: durationMinutes
    });

    await browser.storage.local.set({ nudgeHistory: history.slice(-100) });
    console.log('Nudge logged - Level:', nudgeLevel, 'Count:', nudgeCount);
  } catch (error) {
    console.error('Error logging nudge:', error);
  }
}


window.testNudge = (x) => triggerNudge(x);

// Expose for testing
window.testNudge = (level = 1) => {
  const fakeSession = {
    sessionId: 'test-session',
    currentContext: 'normal',
    totalScrollDistance: 10000,
    totalClicks: 2,
    videoClicks: 2,
    shortsClicks: 0,
    sessionDuration: 3 * 60 * 1000 // 3 minutes
  };
  const fakeSignals = {
    longDuration: true,
    highScrolling: true,
    lowEngagement: false,
    fastScrolling: true,
    lowClickRate: true,
    shortsOverload: false
  };

  let durationMinutes = fakeSession.sessionDuration / 1000 / 60;

  switch(level) {
    case 1:
      durationMinutes = 5; break;
    case 2:
      durationMinutes = 20, nudgeCount = 1; break;
    case 3:
      durationMinutes = 30, nudgeCount = 2; break;
    default:
      durationMinutes = 5;
  }

  triggerNudge(fakeSession, fakeSignals, durationMinutes);
  console.log('Test nudge triggered for level', level);
}


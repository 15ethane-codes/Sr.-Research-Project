console.log('YouTube Scrolling Tracker loaded');

// Notify background that content script is ready for messages
let contentReady = false;

browser.runtime.sendMessage({ action: 'contentReady' }).then(() => {
  contentReady = true;
  console.log('Content script ready for nudges');
});

// Safety check: Only run on YouTube
if (!window.location.hostname.includes('youtube.com')) {
  console.log('Not on YouTube, script will not track');
  throw new Error('Not on YouTube domain');
}

let scrollData = {
  startTime: Date.now(),
  sessionId: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
  scrollEvents: [],
  videoClicks: 0,
  shortsClicks: 0,
  totalScrollDistance: 0,
  lastScrollPosition: 0,
  videoInteractions: [],
  currentVideo: null,
  currentContext: 'unknown',
  timeInShorts: 0,
  timeWatchingVideo: 0,
  lastContextChange: Date.now()
};

// Scroll tracking
let scrollTimeout;
let isActivelyScrolling = false;
let scrollPauseCount = 0;
let lastScrollSaveTime = Date.now();

window.addEventListener('scroll', () => {
  const currentTime = Date.now();
  const scrollY = window.scrollY;
  const scrollDistance = Math.abs(scrollY - scrollData.lastScrollPosition);
  
  isActivelyScrolling = true;

  // Save meaningful scroll events
  if (scrollDistance > 50 || (currentTime - lastScrollSaveTime) > 500) {
    scrollData.scrollEvents.push({
      timestamp: currentTime,
      scrollY: scrollY,
      scrollDistance: scrollDistance
    });
    lastScrollSaveTime = currentTime;
  }

  // Track total distance
  scrollData.totalScrollDistance += scrollDistance;
  scrollData.lastScrollPosition = scrollY;

  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    isActivelyScrolling = false;
    scrollPauseCount++;
    if (Date.now() - currentTime > 3000) {
      console.log('Significant scroll pause detected');
    }
  }, 2000);
});

window.addEventListener('wheel', (event) => {
  if (!scrollData.currentContext.includes('shorts')) return; // Only for Shorts
  
  const currentTime = Date.now();
  const deltaY = Math.abs(event.deltaY);
  
  //console.log('WHEEL EVENT on Shorts:', deltaY);
  
  if (deltaY > 10) { // Meaningful wheel movement
    scrollData.totalScrollDistance += deltaY;
    
    if ((currentTime - lastScrollSaveTime) > 500) {
      scrollData.scrollEvents.push({
        timestamp: currentTime,
        scrollY: window.scrollY,
        scrollDistance: deltaY
      });
      lastScrollSaveTime = currentTime;
      console.log('Shorts wheel event saved, total events:', scrollData.scrollEvents.length);
    }
  }
}, { passive: true });

// Track Shorts scrolling with touch events (mobile/touchpad)
let touchStartY = 0;
window.addEventListener('touchstart', (event) => {
  if (!scrollData.currentContext.includes('shorts')) return;
  touchStartY = event.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (event) => {
  if (!scrollData.currentContext.includes('shorts')) return;
  
  const currentTime = Date.now();
  const touchY = event.touches[0].clientY;
  const touchDistance = Math.abs(touchY - touchStartY);
  
  //console.log('TOUCH EVENT on Shorts:', touchDistance);
  
  if (touchDistance > 50) {
    scrollData.totalScrollDistance += touchDistance;
    
    if ((currentTime - lastScrollSaveTime) > 500) {
      scrollData.scrollEvents.push({
        timestamp: currentTime,
        scrollY: 0, // Shorts don't have scrollY (why:[)
        scrollDistance: touchDistance
      });
      lastScrollSaveTime = currentTime;
      console.log('Shorts touch event saved, total events:', scrollData.scrollEvents.length);
    }
    
    touchStartY = touchY; // Update for next movement
  }
}, { passive: true });

// Video & Shorts click tracking
let lastWatchedVideoId = null;
let lastWatchedShortId = null;

function trackVideoNavigation() {
  const url = window.location.href;

  // Regular video
  if (url.includes('/watch?v=')) {
    const videoId = new URLSearchParams(window.location.search).get('v');

    if (videoId && videoId !== lastWatchedVideoId) {
      scrollData.videoClicks++;
      lastWatchedVideoId = videoId;

      setTimeout(() => {
        const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                             document.querySelector('h1.title yt-formatted-string') ||
                             document.querySelector('h1 yt-formatted-string');
        const title = titleElement ? titleElement.textContent.trim() : 'Unknown Video';

        scrollData.videoInteractions.push({
          timestamp: Date.now(),
          videoUrl: url,
          videoTitle: title.substring(0, 100),
          scrollPosition: window.scrollY,
          type: 'video',
          context: scrollData.currentContext
        });

        console.log('Video opened (count: ' + scrollData.videoClicks + '):', title.substring(0, 50));
        saveScrollData();
      }, 1500);
    }
  }

  // Shorts
  else if (url.includes('/shorts/')) {
    const shortId = url.split('/shorts/')[1]?.split('?')[0];
    if (shortId && shortId !== lastWatchedShortId) {
      scrollData.shortsClicks++;
      lastWatchedShortId = shortId;

      setTimeout(() => {
        const titleElement = document.querySelector('h2.style-scope.ytd-reel-video-renderer') ||
                             document.querySelector('#shorts-player ytd-rich-grid-media h3');
        const title = titleElement ? titleElement.textContent.trim() : 'YouTube Short';

        scrollData.videoInteractions.push({
          timestamp: Date.now(),
          videoUrl: url,
          videoTitle: title.substring(0, 100),
          scrollPosition: window.scrollY,
          type: 'short',
          context: scrollData.currentContext
        });

        console.log('Short opened (Videos: ' + scrollData.videoClicks + ', Shorts: ' + scrollData.shortsClicks + ') -', title);
        saveScrollData();
      }, 1500);
    }
  }
}

// Track current video
function trackCurrentVideo() {
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');

  if (videoId && videoId !== scrollData.currentVideo) {
    scrollData.currentVideo = videoId;

    setTimeout(() => {
      const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                           document.querySelector('h1.title yt-formatted-string') ||
                           document.querySelector('h1 yt-formatted-string');
      const title = titleElement ? titleElement.textContent.trim() : 'Unknown Video';

      scrollData.videoInteractions.push({
        timestamp: Date.now(),
        type: 'video_watch',
        videoId: videoId,
        videoTitle: title,
        url: window.location.href
      });

      console.log('Now watching:', title);
    }, 1500);
  }
}

// Context tracking
function updateContext() {
  const url = window.location.href;
  const previousContext = scrollData.currentContext;
  const now = Date.now();

  if (url.includes('/watch')) {
    scrollData.currentContext = 'watching_video';
    if (previousContext === 'watching_video') {
      scrollData.timeWatchingVideo += (now - scrollData.lastContextChange);
    }
  } else if (url.includes('/shorts/')) {
    scrollData.currentContext = 'shorts_feed';
    if (previousContext === 'shorts_feed') {
      scrollData.timeInShorts += (now - scrollData.lastContextChange);
    }
  } else if (url === 'https://www.youtube.com/' || url === 'https://www.youtube.com') {
    scrollData.currentContext = 'homepage';
  } else if (url.includes('/results')) {
    scrollData.currentContext = 'search_results';
  } else if (url.includes('/feed/subscriptions')) {
    scrollData.currentContext = 'subscriptions';
  } else {
    scrollData.currentContext = 'other';
  }

  scrollData.lastContextChange = now;

  if (previousContext !== scrollData.currentContext) {
    console.log('Context changed:', previousContext, 'to', scrollData.currentContext);
  }
}

// Watch for SPA URL changes
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    updateContext();
    trackVideoNavigation();
    setTimeout(trackCurrentVideo, 1000);
  }
}).observe(document, {subtree: true, childList: true});

// Initialize context
updateContext();
trackVideoNavigation();

// Auto-save
function saveScrollData() {
  updateContext();

  const totalClicks = scrollData.videoClicks + scrollData.shortsClicks;

  const sessionData = {
    sessionId: scrollData.sessionId,
    startTime: scrollData.startTime,
    scrollEvents: scrollData.scrollEvents,
    videoClicks: scrollData.videoClicks,
    shortsClicks: scrollData.shortsClicks,
    totalClicks: totalClicks,
    totalScrollDistance: scrollData.totalScrollDistance,
    lastScrollPosition: scrollData.lastScrollPosition,
    videoInteractions: scrollData.videoInteractions,
    currentVideo: scrollData.currentVideo,
    currentContext: scrollData.currentContext,
    timeInShorts: scrollData.timeInShorts,
    timeWatchingVideo: scrollData.timeWatchingVideo,
    sessionDuration: Date.now() - scrollData.startTime,
    url: window.location.href,
    timestamp: Date.now(),
    scrollPauseCount: scrollPauseCount,
    isActivelyScrolling: isActivelyScrolling
  };

  console.log('Attempting to save data:', {
    sessionId: scrollData.sessionId,
    duration: Math.round(sessionData.sessionDuration / 1000) + 's',
    context: scrollData.currentContext,
    scrolls: scrollData.scrollEvents.length,
    videos: scrollData.videoClicks,
    shorts: scrollData.shortsClicks
  });

  browser.runtime.sendMessage({ action: 'saveScrollData', data: sessionData })
    .then(response => console.log('Data saved successfully:', response))
    .catch(error => console.error('Failed to save data:', error));
}

// Auto-save every 30 seconds
console.log('Setting up auto-save interval (every 30 seconds)');
setInterval(() => {
  console.log('Auto-save triggered');
  saveScrollData();
}, 30000);

// Save on unload
window.addEventListener('beforeunload', () => {
  console.log('Page closing, saving data');
  saveScrollData();
});

// Initialize tracking
console.log('Initializing YouTube tracking');
trackCurrentVideo();

console.log('YouTube tracking initialized');


// NUDGE SYSTEM - newest additions for Version 1.1

// Listen for nudge messages from background
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showAwarenessBanner') {
    showAwarenessBanner(message.message, message.nudgeType);
  } else if (message.action === 'showSuggestionPrompt') {
    showSuggestionPrompt(message.suggestions, message.duration, message.nudgeType);
  } else if (message.action === 'activateScrollResistance') {
    activateScrollResistance(message.duration, message.context);
  }
});

// Level 1: Awareness banner (gentle, dismissable)
function showAwarenessBanner(message, nudgeType) {
  // Remove existing banner if any
  const existing = document.getElementById('awareness-banner');
  if (existing) existing.remove();
  
  const banner = document.createElement('div');
  banner.id = 'awareness-banner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 10px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      z-index: 99999;
      max-width: 320px;
      font-family: 'Segoe UI', sans-serif;
      animation: slideIn 0.3s ease-out;
    ">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
        <div style="font-weight: 600; font-size: 15px;">Time Check</div>
        <button id="banner-close" style="
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        ">×</button>
      </div>
      <div style="font-size: 13px; opacity: 0.95;">
        ${message}
      </div>
    </div>
    <style>
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    </style>
  `;
  
  document.body.appendChild(banner);
  
  // Close button
  document.getElementById('banner-close').addEventListener('click', () => {
    banner.remove();
  });
  
  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    if (banner.parentElement) {
      banner.remove();
    }
  }, 8000);
}

// Level 2: Suggestion prompt (medium friction)
function showSuggestionPrompt(suggestions, duration, nudgeType) {
  // Remove existing prompts
  const existing = document.getElementById('suggestion-prompt');
  if (existing) existing.remove();
  
  const prompt = document.createElement('div');
  prompt.id = 'suggestion-prompt';
  
  const suggestionButtons = suggestions.map((suggestion, index) => `
    <button class="suggestion-btn" data-index="${index}" style="
      width: 100%;
      padding: 12px;
      background: rgba(102, 126, 234, 0.1);
      border: 2px solid #667eea;
      border-radius: 8px;
      color: #667eea;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 8px;
      transition: all 0.2s;
    " onmouseover="this.style.background='#667eea'; this.style.color='white';" 
       onmouseout="this.style.background='rgba(102, 126, 234, 0.1)'; this.style.color='#667eea';">
      ${suggestion}
    </button>
  `).join('');
  
  prompt.innerHTML = `
    <div style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4);
      z-index: 999999;
      max-width: 380px;
      width: 90%;
      font-family: 'Segoe UI', sans-serif;
    ">
      <div style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #333;">
        You've been here ${duration} minutes
      </div>
      <div style="font-size: 14px; margin-bottom: 20px; color: #666;">
        What would you like to do?
      </div>
      ${suggestionButtons}
      <button id="prompt-dismiss" style="
        width: 100%;
        padding: 10px;
        background: #f5f5f5;
        border: none;
        border-radius: 6px;
        color: #666;
        cursor: pointer;
        font-size: 13px;
      ">Keep browsing</button>
    </div>
    <div id="prompt-backdrop" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.6);
      z-index: 999998;
    "></div>
  `;
  
  document.body.appendChild(prompt);
  
  // Handle suggestion clicks
  prompt.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index);
      handleSuggestionClick(suggestions[index]);
      prompt.remove();
    });
  });
  
  // Dismiss button
  document.getElementById('prompt-dismiss').addEventListener('click', () => {
    prompt.remove();
  });
  
  // Click backdrop to dismiss
  document.getElementById('prompt-backdrop').addEventListener('click', () => {
    prompt.remove();
  });
}

function handleSuggestionClick(suggestion) {
  console.log('User selected suggestion:', suggestion);
  
  if (suggestion.includes('break') || suggestion.includes('Close')) {
    // User chose to take a break or close
    window.close();
  } else if (suggestion.includes('Search')) {
    // Focus search box
    const searchBox = document.querySelector('input#search');
    if (searchBox) searchBox.focus();
  } else if (suggestion.includes('subscriptions')) {
    // Navigate to subscriptions
    window.location.href = 'https://www.youtube.com/feed/subscriptions';
  } else if (suggestion.includes('Watch Later')) {
    // Navigate to Watch Later
    window.location.href = 'https://www.youtube.com/playlist?list=WL';
  }
}

// Level 3: Scroll resistance (high friction)
let scrollResistanceActive = false;
let scrollAccumulator = 0;
const SCROLL_THRESHOLD = 100;

function activateScrollResistance(duration, context) {
  if (scrollResistanceActive) return;
  
  scrollResistanceActive = true;
  console.log('SCROLL RESISTANCE ACTIVATED');
  
  showScrollResistanceOverlay(duration, context);
  
  // Intercept scroll events
  window.addEventListener('wheel', resistScroll, { passive: false });
  window.addEventListener('touchmove', resistScroll, { passive: false });
  window.addEventListener('keydown', resistScrollKeys, { passive: false });
}

function resistScroll(event) {
  if (!scrollResistanceActive) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  // Accumulate scroll attempts
  const delta = Math.abs(event.deltaY || 0);
  scrollAccumulator += delta;
  
  // Update progress bar
  updateResistanceProgress(scrollAccumulator / SCROLL_THRESHOLD);
  
  // Only allow scroll after threshold
  if (scrollAccumulator >= SCROLL_THRESHOLD) {
    window.scrollBy(0, Math.sign(event.deltaY || 0) * 50);
    scrollAccumulator = 0;
    flashResistanceIndicator();
  }
}

function resistScrollKeys(event) {
  if (!scrollResistanceActive) return;
  
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Space'].includes(event.code)) {
    event.preventDefault();
    scrollAccumulator += 20;
    updateResistanceProgress(scrollAccumulator / SCROLL_THRESHOLD);
  }
}

function showScrollResistanceOverlay(duration, context) {
  const overlay = document.createElement('div');
  overlay.id = 'scroll-resistance-overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
      color: white;
      padding: 20px;
      z-index: 999999;
      text-align: center;
      border-bottom: 4px solid rgba(255,255,255,0.3);
      font-family: 'Segoe UI', sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    ">
      <div style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">
        Scroll Resistance Active
      </div>
      <div style="font-size: 13px; opacity: 0.95; margin-bottom: 14px;">
        ${duration} minutes of scrolling detected. Scrolling is now intentionally slowed.
      </div>
      <div style="
        width: 100%;
        max-width: 400px;
        height: 6px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 3px;
        margin: 0 auto 12px auto;
        overflow: hidden;
      ">
        <div id="resistance-progress-fill" style="
          width: 0%;
          height: 100%;
          background: white;
          transition: width 0.1s;
        "></div>
      </div>
      <div style="font-size: 11px; opacity: 0.8; margin-bottom: 10px;">
        Keep scrolling to continue, or:
      </div>
      <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
        <button id="resistance-disable" style="
          padding: 8px 16px;
          background: rgba(255,255,255,0.2);
          border: 1px solid rgba(255,255,255,0.4);
          border-radius: 6px;
          color: white;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
        ">Disable</button>
        <button id="resistance-close" style="
          padding: 8px 16px;
          background: white;
          border: none;
          border-radius: 6px;
          color: #ff6b6b;
          cursor: pointer;
          font-weight: 600;
          font-size: 13px;
        ">Close YouTube</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  document.getElementById('resistance-disable').addEventListener('click', () => {
    deactivateScrollResistance();
    overlay.remove();
  });
  
  document.getElementById('resistance-close').addEventListener('click', () => {
    window.close();
  });
}

function updateResistanceProgress(progress) {
  const fill = document.getElementById('resistance-progress-fill');
  if (fill) {
    fill.style.width = (Math.min(progress, 1) * 100) + '%';
  }
}

function flashResistanceIndicator() {
  const fill = document.getElementById('resistance-progress-fill');
  if (fill) {
    fill.style.background = '#FFC107';
    setTimeout(() => {
      fill.style.background = 'white';
    }, 150);
  }
}

function deactivateScrollResistance() {
  scrollResistanceActive = false;
  scrollAccumulator = 0;
  window.removeEventListener('wheel', resistScroll);
  window.removeEventListener('touchmove', resistScroll);
  window.removeEventListener('keydown', resistScrollKeys);
  console.log('Scroll resistance deactivated');
}

console.log('Nudge system initialized');
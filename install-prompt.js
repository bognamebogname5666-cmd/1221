/**
 * NEXUS BLOCKS — Install Prompt
 * ─────────────────────────────────────────────────────────────────────────────
 * Custom PWA install banner using the deferred beforeinstallprompt pattern.
 *
 * Features:
 *   • Captures beforeinstallprompt and defers the native browser dialog
 *   • Shows a branded install banner after the user has engaged with the game
 *     (minimum 2 completed games OR 30 seconds on the menu)
 *   • Tracks install analytics (accepted / dismissed / already-installed)
 *   • Respects user dismissal — waits 7 days before showing again
 *   • CSS reads --color-primary and --color-bg from styles.css (no redeclaration)
 *   • Registers the service worker and handles SW update notifications
 */

'use strict';

/* ══════════════════════════════════════════════════════════════════════════════
   1 · SERVICE WORKER REGISTRATION
══════════════════════════════════════════════════════════════════════════════ */

(function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js', {
        scope:        '/',
        updateViaCache: 'none',
      });

      console.log('[PWA] Service worker registered:', reg.scope);

      // Detect SW update waiting to activate
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;

        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            // A new SW is waiting — show update toast
            InstallUI.showUpdateToast(reg);
          }
        });
      });

      // Handle messages from the service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, version } = event.data ?? {};
        if (type === 'SW_ACTIVATED') {
          console.log('[PWA] New service worker activated, version:', version);
        }
        if (type === 'PUSH_NAVIGATE' && event.data.url) {
          const params = new URLSearchParams(new URL(event.data.url, location.href).search);
          const mode = params.get('mode');
          if (mode) {
            window.bus?.emit('pwa:navigate', { mode });
          }
        }
      });

      // Request periodic background sync for leaderboard refresh
      if ('periodicSync' in reg) {
        try {
          await reg.periodicSync.register('refresh-leaderboard', { minInterval: 24 * 60 * 60 * 1000 });
        } catch { /* Permission not granted — ignore */ }
      }

    } catch (err) {
      console.warn('[PWA] Service worker registration failed:', err);
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════════
   2 · INSTALL ANALYTICS
══════════════════════════════════════════════════════════════════════════════ */

const InstallAnalytics = (() => {
  const KEY = 'nexus_install_analytics';

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }

  function _save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  }

  function track(event, extra = {}) {
    const data = _load();
    if (!data.events) data.events = [];
    data.events.push({ event, ts: Date.now(), ...extra });
    _save(data);
    // If a real analytics endpoint exists, forward the event
    if (typeof gtag === 'function') {
      gtag('event', `pwa_${event}`, { event_category: 'PWA', ...extra });
    }
    // Forward to the game's EventBus if available
    window.bus?.emit(`pwa:${event}`, extra);
    console.log(`[PWA Analytics] ${event}`, extra);
  }

  function getDismissedAt() {
    return _load().dismissedAt ?? 0;
  }

  function recordDismiss() {
    const data = _load();
    data.dismissedAt = Date.now();
    _save(data);
    track('banner_dismissed');
  }

  function recordAccept() {
    const data = _load();
    data.acceptedAt = Date.now();
    _save(data);
    track('install_accepted');
  }

  function isInstalled() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true  // iOS Safari
    );
  }

  return { track, getDismissedAt, recordDismiss, recordAccept, isInstalled };
})();

/* ══════════════════════════════════════════════════════════════════════════════
   3 · ENGAGEMENT TRACKER — show prompt after real engagement
══════════════════════════════════════════════════════════════════════════════ */

const EngagementTracker = (() => {
  const KEY = 'nexus_engagement';
  const GAMES_THRESHOLD   = 2;     // completed games before showing prompt
  const TIME_THRESHOLD_MS = 30000; // ms on menu before showing prompt

  let menuOpenedAt = null;
  let menuTimer    = null;

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }

  function _save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {}
  }

  /** Call when the player completes a game (game:over event). */
  function onGameCompleted() {
    const d = _load();
    d.gamesCompleted = (d.gamesCompleted ?? 0) + 1;
    _save(d);
    _checkThresholds();
  }

  /** Call when the main menu becomes visible. */
  function onMenuOpen() {
    menuOpenedAt = Date.now();
    menuTimer = setTimeout(() => _checkThresholds(), TIME_THRESHOLD_MS);
  }

  /** Call when the main menu is hidden. */
  function onMenuClose() {
    if (menuTimer) { clearTimeout(menuTimer); menuTimer = null; }
    menuOpenedAt = null;
  }

  function hasMetThreshold() {
    const d = _load();
    const gamesOk = (d.gamesCompleted ?? 0) >= GAMES_THRESHOLD;
    const timeOk  = menuOpenedAt && (Date.now() - menuOpenedAt) >= TIME_THRESHOLD_MS;
    return gamesOk || timeOk;
  }

  function _checkThresholds() {
    if (hasMetThreshold()) {
      InstallUI.maybeTrigger();
    }
  }

  return { onGameCompleted, onMenuOpen, onMenuClose, hasMetThreshold };
})();

/* ══════════════════════════════════════════════════════════════════════════════
   4 · INSTALL UI — custom banner and update toast
══════════════════════════════════════════════════════════════════════════════ */

const InstallUI = (() => {
  const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  let deferredPrompt = null;
  let bannerEl       = null;
  let toastEl        = null;
  let shown          = false;

  // ── CSS injected once (reads from brand tokens — never redeclares them) ──────
  function _injectStyles() {
    if (document.getElementById('pwa-install-styles')) return;
    const style = document.createElement('style');
    style.id = 'pwa-install-styles';
    style.textContent = `
      /* ── Install Banner ─────────────────────────────────────── */
      #pwa-install-banner {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        z-index: 9000;
        padding: 16px;
        transform: translateY(120%);
        transition: transform 350ms cubic-bezier(0.22, 1, 0.36, 1);
        will-change: transform;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        pointer-events: none;
      }
      #pwa-install-banner.visible {
        transform: translateY(0);
        pointer-events: auto;
      }
      .pwa-banner-card {
        width: 100%;
        max-width: 480px;
        background: rgba(14, 10, 28, 0.97);
        border: 1px solid var(--color-primary, #6600FF);
        border-radius: 20px;
        box-shadow:
          0 0 0 1px rgba(102, 0, 255, 0.3),
          0 -4px 40px rgba(102, 0, 255, 0.25),
          0 20px 60px rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .pwa-banner-top {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 18px 20px 14px;
      }
      .pwa-banner-icon {
        width: 56px;
        height: 56px;
        border-radius: 14px;
        flex-shrink: 0;
        border: 1px solid rgba(102, 0, 255, 0.5);
        background: var(--color-bg, #0A0A0F);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .pwa-banner-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .pwa-banner-text {
        flex: 1;
        min-width: 0;
      }
      .pwa-banner-title {
        font-family: var(--font-display, 'Outfit', sans-serif);
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: .08em;
        color: #F4F4F6;
        margin: 0 0 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pwa-banner-subtitle {
        font-family: var(--font-body, 'Inter', sans-serif);
        font-size: .78rem;
        color: #8E8E9F;
        margin: 0;
        line-height: 1.3;
      }
      .pwa-banner-dismiss {
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #8E8E9F;
        font-size: .8rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, color 0.15s;
        line-height: 1;
      }
      .pwa-banner-dismiss:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #F4F4F6;
      }
      .pwa-banner-features {
        display: flex;
        gap: 0;
        padding: 0 20px 14px;
        flex-wrap: wrap;
      }
      .pwa-feature-pill {
        font-family: var(--font-body, 'Inter', sans-serif);
        font-size: .68rem;
        letter-spacing: .04em;
        color: var(--color-primary, #6600FF);
        background: rgba(102, 0, 255, 0.1);
        border: 1px solid rgba(102, 0, 255, 0.3);
        border-radius: 99px;
        padding: 3px 10px;
        margin: 0 6px 6px 0;
        white-space: nowrap;
      }
      .pwa-banner-actions {
        display: flex;
        gap: 10px;
        padding: 0 20px 20px;
      }
      .pwa-btn-install {
        flex: 1;
        padding: 13px 20px;
        border-radius: 12px;
        border: none;
        background: var(--color-primary, #6600FF);
        color: #fff;
        font-family: var(--font-display, 'Outfit', sans-serif);
        font-size: .82rem;
        font-weight: 700;
        letter-spacing: .12em;
        text-transform: uppercase;
        cursor: pointer;
        transition: filter 0.15s, transform 0.1s;
      }
      .pwa-btn-install:hover   { filter: brightness(1.2); }
      .pwa-btn-install:active  { transform: scale(0.97); }
      .pwa-btn-later {
        padding: 13px 20px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: transparent;
        color: #8E8E9F;
        font-family: var(--font-display, 'Outfit', sans-serif);
        font-size: .78rem;
        font-weight: 600;
        letter-spacing: .1em;
        text-transform: uppercase;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
        white-space: nowrap;
      }
      .pwa-btn-later:hover  { background: rgba(255,255,255,.06); color: #F4F4F6; }

      /* ── Update Toast ────────────────────────────────────────── */
      #pwa-update-toast {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%) translateY(-120px);
        z-index: 9001;
        transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
        pointer-events: none;
        width: calc(100% - 32px);
        max-width: 400px;
      }
      #pwa-update-toast.visible {
        transform: translateX(-50%) translateY(0);
        pointer-events: auto;
      }
      .pwa-toast-card {
        background: rgba(14, 10, 28, 0.97);
        border: 1px solid rgba(0, 240, 255, 0.5);
        border-radius: 14px;
        padding: 14px 18px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
      }
      .pwa-toast-text {
        flex: 1;
        font-family: var(--font-display, 'Outfit', sans-serif);
        font-size: .82rem;
        color: #F4F4F6;
        letter-spacing: .04em;
      }
      .pwa-btn-reload {
        padding: 7px 16px;
        border-radius: 8px;
        border: none;
        background: rgba(0, 240, 255, 0.15);
        color: #00F0FF;
        font-family: var(--font-display, 'Outfit', sans-serif);
        font-size: .75rem;
        font-weight: 700;
        letter-spacing: .1em;
        text-transform: uppercase;
        cursor: pointer;
        border: 1px solid rgba(0, 240, 255, 0.4);
        transition: background 0.15s;
        white-space: nowrap;
      }
      .pwa-btn-reload:hover { background: rgba(0, 240, 255, 0.28); }
      .pwa-btn-toast-close {
        width: 26px; height: 26px;
        border-radius: 50%;
        border: none;
        background: rgba(255,255,255,.07);
        color: #8E8E9F;
        font-size: .75rem;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }

      /* ── iOS instructions overlay ───────────────────────────── */
      #pwa-ios-overlay {
        position: fixed;
        inset: 0;
        z-index: 9002;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: flex-end;
        padding: 16px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 250ms ease;
      }
      #pwa-ios-overlay.visible {
        opacity: 1;
        pointer-events: auto;
      }
      .pwa-ios-card {
        width: 100%;
        max-width: 480px;
        margin: 0 auto;
        background: rgba(18, 12, 36, 0.98);
        border: 1px solid var(--color-primary, #6600FF);
        border-radius: 20px;
        padding: 24px 20px;
        text-align: center;
      }
      .pwa-ios-title {
        font-family: var(--font-display, 'Outfit', sans-serif);
        font-size: 1.1rem;
        font-weight: 700;
        color: #F4F4F6;
        letter-spacing: .06em;
        margin-bottom: 8px;
      }
      .pwa-ios-instructions {
        font-family: var(--font-body, 'Inter', sans-serif);
        font-size: .85rem;
        color: #8E8E9F;
        line-height: 1.6;
        margin-bottom: 20px;
      }
      .pwa-ios-instructions strong { color: #F4F4F6; }
      .pwa-ios-arrow {
        display: block;
        text-align: center;
        font-size: 2rem;
        margin-bottom: 16px;
        animation: pwaArrowBounce 1s ease-in-out infinite;
      }
      @keyframes pwaArrowBounce {
        0%,100% { transform: translateY(0); }
        50%      { transform: translateY(-6px); }
      }
      .pwa-btn-ios-close {
        padding: 12px 32px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.15);
        background: transparent;
        color: #8E8E9F;
        font-family: var(--font-display, 'Outfit', sans-serif);
        font-size: .78rem;
        font-weight: 600;
        letter-spacing: .1em;
        text-transform: uppercase;
        cursor: pointer;
      }

      @media (max-width: 400px) {
        .pwa-banner-features { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build install banner DOM ──────────────────────────────────────────────
  function _buildBanner() {
    if (bannerEl) return;

    const div = document.createElement('div');
    div.id = 'pwa-install-banner';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-label', 'Install NEXUS BLOCKS as an app');
    div.setAttribute('aria-live', 'polite');

    div.innerHTML = `
      <div class="pwa-banner-card">
        <div class="pwa-banner-top">
          <div class="pwa-banner-icon">
            <img src="/icons/icon-96.png"
                 alt="NEXUS BLOCKS icon"
                 width="56" height="56"
                 loading="lazy"
                 onerror="this.style.display='none'" />
          </div>
          <div class="pwa-banner-text">
            <p class="pwa-banner-title">Install NEXUS BLOCKS</p>
            <p class="pwa-banner-subtitle">Play offline &amp; full-screen for free</p>
          </div>
          <button class="pwa-banner-dismiss"
                  aria-label="Dismiss install prompt"
                  id="pwa-dismiss-btn">✕</button>
        </div>
        <div class="pwa-banner-features">
          <span class="pwa-feature-pill">📵 Full offline play</span>
          <span class="pwa-feature-pill">🔔 Score alerts</span>
          <span class="pwa-feature-pill">⚡ Instant launch</span>
          <span class="pwa-feature-pill">📱 No app store needed</span>
        </div>
        <div class="pwa-banner-actions">
          <button class="pwa-btn-install" id="pwa-install-btn">
            Install App
          </button>
          <button class="pwa-btn-later" id="pwa-later-btn">
            Not Now
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(div);
    bannerEl = div;

    // Wire up buttons
    document.getElementById('pwa-install-btn')?.addEventListener('click', _triggerInstall);
    document.getElementById('pwa-later-btn')?.addEventListener('click', _dismiss);
    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', _dismiss);
  }

  // ── Build iOS instructions overlay ───────────────────────────────────────
  function _buildIOSOverlay() {
    const div = document.createElement('div');
    div.id = 'pwa-ios-overlay';
    div.setAttribute('role', 'dialog');
    div.setAttribute('aria-label', 'How to install on iOS');
    div.innerHTML = `
      <div class="pwa-ios-card">
        <p class="pwa-ios-title">Add to Home Screen</p>
        <span class="pwa-ios-arrow">⬆</span>
        <p class="pwa-ios-instructions">
          Tap the <strong>Share</strong> button <strong>⎙</strong> at the bottom of
          your browser, then select <strong>"Add to Home Screen"</strong>.
        </p>
        <button class="pwa-btn-ios-close" id="pwa-ios-close">Got it</button>
      </div>
    `;
    document.body.appendChild(div);
    document.getElementById('pwa-ios-close')?.addEventListener('click', () => {
      div.classList.remove('visible');
      InstallAnalytics.recordDismiss();
    });
    return div;
  }

  // ── Show banner ────────────────────────────────────────────────────────────
  function _show() {
    if (shown) return;
    shown = true;
    _injectStyles();
    _buildBanner();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bannerEl?.classList.add('visible');
    }));
    InstallAnalytics.track('banner_shown');
  }

  // ── Dismiss banner ─────────────────────────────────────────────────────────
  function _dismiss() {
    bannerEl?.classList.remove('visible');
    shown = false;
    InstallAnalytics.recordDismiss();
    setTimeout(() => bannerEl?.remove(), 400);
    bannerEl = null;
  }

  // ── Trigger native install prompt ──────────────────────────────────────────
  async function _triggerInstall() {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;

      if (outcome === 'accepted') {
        InstallAnalytics.recordAccept();
        _dismiss();
      } else {
        InstallAnalytics.recordDismiss();
        _dismiss();
      }
    } catch (err) {
      console.warn('[PWA] Install prompt error:', err);
    }
  }

  // ── Maybe trigger: guard rails ─────────────────────────────────────────────
  function maybeTrigger() {
    if (InstallAnalytics.isInstalled()) return;
    if (!deferredPrompt && !_isIOS()) return;

    const dismissedAt = InstallAnalytics.getDismissedAt();
    const cooldownOk  = Date.now() - dismissedAt > 7 * 24 * 60 * 60 * 1000;
    if (!cooldownOk) return;

    if (_isIOS() && _isSafari()) {
      // iOS Safari: show manual instructions
      _injectStyles();
      const overlay = _buildIOSOverlay();
      requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));
      InstallAnalytics.track('ios_instructions_shown');
    } else if (deferredPrompt) {
      _show();
    }
  }

  // ── Show update toast ──────────────────────────────────────────────────────
  function showUpdateToast(swRegistration) {
    if (toastEl) return;
    _injectStyles();

    const div = document.createElement('div');
    div.id = 'pwa-update-toast';
    div.innerHTML = `
      <div class="pwa-toast-card">
        <span class="pwa-toast-text">Update available! Refresh to play the latest version.</span>
        <button class="pwa-btn-reload" id="pwa-reload-btn">Refresh</button>
        <button class="pwa-btn-toast-close" id="pwa-toast-close" aria-label="Dismiss update">✕</button>
      </div>
    `;
    document.body.appendChild(div);
    toastEl = div;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      toastEl?.classList.add('visible');
    }));

    document.getElementById('pwa-reload-btn')?.addEventListener('click', () => {
      swRegistration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    });
    document.getElementById('pwa-toast-close')?.addEventListener('click', () => {
      toastEl?.classList.remove('visible');
      setTimeout(() => { toastEl?.remove(); toastEl = null; }, 350);
    });
  }

  // ── OS/browser detection ───────────────────────────────────────────────────
  function _isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function _isSafari() {
    return /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/.test(navigator.userAgent);
  }

  // ── Public setDeferredPrompt ───────────────────────────────────────────────
  function setDeferredPrompt(prompt) {
    deferredPrompt = prompt;
  }

  return { maybeTrigger, setDeferredPrompt, showUpdateToast };
})();

/* ══════════════════════════════════════════════════════════════════════════════
   5 · CAPTURE beforeinstallprompt
══════════════════════════════════════════════════════════════════════════════ */

window.addEventListener('beforeinstallprompt', (event) => {
  // Prevent the default mini-infobar on Chrome for Android
  event.preventDefault();
  InstallUI.setDeferredPrompt(event);
  InstallAnalytics.track('prompt_available', { platform: navigator.platform });

  // If the user has already met engagement thresholds, show immediately
  if (EngagementTracker.hasMetThreshold()) {
    InstallUI.maybeTrigger();
  }
});

// ── Track if already installed ─────────────────────────────────────────────────
window.addEventListener('appinstalled', () => {
  InstallAnalytics.track('app_installed');
  window.bus?.emit('pwa:installed');
  console.log('[PWA] App was installed!');
});

/* ══════════════════════════════════════════════════════════════════════════════
   6 · WIRE INTO GAME EVENTS
══════════════════════════════════════════════════════════════════════════════ */

(function wireGameEvents() {
  // Wait for the game bus to be ready
  const tryWire = () => {
    const bus = window.bus;
    if (!bus) { setTimeout(tryWire, 100); return; }

    bus.on('game:over',   () => EngagementTracker.onGameCompleted());
    bus.on('game:state',  ({ to } = {}) => {
      if (to === 'MENU')    EngagementTracker.onMenuOpen();
      if (to !== 'MENU')    EngagementTracker.onMenuClose();
    });

    // Wire push subscription to the settings 'notifications' toggle if it exists
    bus.on('settings:changed', ({ key, value } = {}) => {
      if (key === 'notifications' && value) {
        requestPushPermission();
      }
    });
  };

  if (document.readyState === 'complete') {
    tryWire();
  } else {
    window.addEventListener('load', tryWire);
  }
})();

/* ══════════════════════════════════════════════════════════════════════════════
   7 · PUSH NOTIFICATION SUBSCRIPTION
══════════════════════════════════════════════════════════════════════════════ */

// VAPID public key — replace with your actual key in production
const VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

function urlBase64ToUint8Array(base64String) {
  const padding   = '='.repeat((4 - base64String.length % 4) % 4);
  const base64    = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData   = atob(base64);
  const outputArr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArr[i] = rawData.charCodeAt(i);
  }
  return outputArr;
}

async function requestPushPermission() {
  if (!('Notification' in window) || !('PushManager' in window)) return;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    InstallAnalytics.track('push_denied');
    return;
  }

  try {
    const reg          = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    InstallAnalytics.track('push_subscribed');

    // Send subscription to your server
    // In production, POST to your real endpoint:
    // await fetch('/api/push/subscribe', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(subscription.toJSON()),
    // });

    console.log('[PWA] Push subscription:', JSON.stringify(subscription.toJSON()));
    localStorage.setItem('nexus_push_subscription', JSON.stringify(subscription.toJSON()));

  } catch (err) {
    console.warn('[PWA] Push subscription failed:', err);
    InstallAnalytics.track('push_error', { error: err.message });
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   8 · SCORE BACKGROUND SYNC HELPER
   Called by the game when submitting a score while potentially offline
══════════════════════════════════════════════════════════════════════════════ */

window.NexusPWA = {
  /** Submit a score — uses background sync if offline */
  async submitScore(payload) {
    if (!('serviceWorker' in navigator)) {
      // Fallback: direct fetch
      return fetch('/api/scores', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    }

    const sw = await navigator.serviceWorker.ready;
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage({ type: 'QUEUE_SCORE', payload });
    }
  },

  /** Request push notification permission */
  requestPushPermission,

  /** Manually trigger the install prompt */
  triggerInstallPrompt() {
    InstallUI.maybeTrigger();
  },

  /** Check if already installed as PWA */
  isInstalled: InstallAnalytics.isInstalled,
};

// "Install app" prompt (Android/Chrome/Edge) and Add-to-Home-Screen hint (iPhone/iPad).
const Install = (() => {
  const DISMISS_KEY = 'selfup_install_dismissed';
  let deferred = null;
  let banner = null;

  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

  function hide(remember) {
    if (banner) banner.remove();
    banner = null;
    if (remember) { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } }
  }

  function show(text, actionLabel, action) {
    if (banner || standalone() || dismissed()) return;
    banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Install Small Wins');
    banner.innerHTML = '<span class="install-text"></span><span class="install-actions"></span>';
    banner.querySelector('.install-text').textContent = text;
    const actions = banner.querySelector('.install-actions');
    if (action) {
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'btn btn-primary'; go.textContent = actionLabel;
      go.addEventListener('click', action);
      actions.appendChild(go);
    }
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'btn'; no.textContent = action ? 'Not now' : 'Got it';
    no.addEventListener('click', () => hide(true));
    actions.appendChild(no);
    document.body.appendChild(banner);
  }

  async function prompt() {
    if (!deferred) return false;
    const evt = deferred;
    deferred = null;
    evt.prompt();
    const choice = await evt.userChoice.catch(() => null);
    hide(false);
    return !!choice && choice.outcome === 'accepted';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    show('Install Small Wins on this device to use it offline.', 'Install', prompt);
  });
  window.addEventListener('appinstalled', () => { deferred = null; hide(false); });

  function init() {
    if (standalone() || dismissed()) return;
    if (isIos()) {
      setTimeout(() => show('To install: tap Share, then "Add to Home Screen". It will work offline.', null, null), 3000);
    }
  }

  return { init, prompt, canInstall: () => !!deferred, isStandalone: standalone };
})();

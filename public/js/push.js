// Wraps the browser Push/Notification APIs. Every call is defensive since
// this has to run fine on browsers/contexts that don't support push at all
// (e.g. desktop Safari, or the app opened over plain http).
const Push = (() => {
  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function permission() {
    return supported() ? Notification.permission : 'unsupported';
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      reg.update().catch(() => {});
      return reg;
    } catch (e) {
      console.warn('Service worker registration failed:', e);
      return null;
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  // Full opt-in flow: register SW, ask permission, subscribe, send the
  // subscription to the backend. Returns true on success.
  async function enable() {
    if (!supported()) throw new Error('This browser does not support push notifications.');

    const { key, configured } = await Api.get('/notifications/vapid-public-key');
    if (!configured || !key) throw new Error('Push notifications aren\'t set up on this server yet.');

    const reg = await registerServiceWorker();
    if (!reg) throw new Error('Could not register the service worker.');

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notification permission was not granted.');

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    await Api.post('/notifications/subscribe', sub.toJSON());
    return true;
  }

  async function disable() {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await Api.post('/notifications/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    } else {
      await Api.post('/notifications/unsubscribe', {}).catch(() => {});
    }
  }

  return { supported, permission, enable, disable, registerServiceWorker };
})();

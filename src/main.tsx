import 'zapkit-tv/styles.css';
import './styles/app.css';
import './components/icons';
import Hls from 'hls.js';
import { h, OverlayStage, RouterView, ToastStage, createRouter, focus, installScaling, registerPlatformKeys, render } from 'zapkit-tv';
import { setHlsConstructor } from 'zapkit-tv/player';
import { api, EVENTS } from './services/api';
import { playback } from './services/media';
import { exitApp } from './services/platform';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { Live } from './screens/Live';
import { Movies } from './screens/Movies';
import { Series } from './screens/Series';
import { SeriesDetail } from './screens/SeriesDetail';
import { Watch } from './screens/Watch';

setHlsConstructor(Hls as any);

const router = createRouter({
  routes: [
    { path: '/login', component: Login },
    { path: '/', component: Home, keepAlive: true },
    { path: '/live', component: Live, keepAlive: true },
    { path: '/movies', component: Movies, keepAlive: true },
    { path: '/series', component: Series, keepAlive: true },
    { path: '/series/:id', component: SeriesDetail, keepAlive: true },
    { path: '/watch', component: Watch },
  ],
  initial: api.isLoggedIn ? '/' : '/login',
  onExit: () => {
    exitApp();
    return true;
  },
});

// Saved session: start on the home screen and re-check the account quietly.
// Only a rejected login signs out; network errors keep the cached session.
if (api.isLoggedIn) {
  api.authenticate().catch((e: Error) => {
    if (/Giriş başarısız/.test(e.message)) api.clearSession();
  });
}

window.addEventListener(EVENTS.authChanged, () => {
  if (!api.isLoggedIn && (!router.current || router.current.path !== '/login')) router.reset('/login');
});

installScaling();
registerPlatformKeys();
render(
  <div className="kb-scale">
    <RouterView router={router} />
    <OverlayStage />
    <ToastStage />
  </div>,
  document.getElementById('app')!,
);
focus.start(document.body);

api.startAutoRefresh(() => playback.active);

// Service workers need a secure context (https or localhost); plain-http LAN
// addresses skip this and run as a normal page.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

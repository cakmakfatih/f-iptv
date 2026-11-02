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
import { Profiles } from './screens/Profiles';
import { Home } from './screens/Home';
import { Live } from './screens/Live';
import { Movies } from './screens/Movies';
import { Series } from './screens/Series';
import { SeriesDetail } from './screens/SeriesDetail';
import { Watch } from './screens/Watch';

setHlsConstructor(Hls as any);

const router = createRouter({
  routes: [
    { path: '/profiles', component: Profiles },
    { path: '/login', component: Login },
    { path: '/', component: Home, keepAlive: true },
    { path: '/live', component: Live, keepAlive: true },
    { path: '/movies', component: Movies, keepAlive: true },
    { path: '/series', component: Series, keepAlive: true },
    { path: '/series/:id', component: SeriesDetail, keepAlive: true },
    { path: '/watch', component: Watch },
  ],
  // Always start on the picker (with nothing saved it only offers "add").
  initial: '/profiles',
  onExit: () => {
    exitApp();
    return true;
  },
});

// Signing out (or a rejected login) returns to the picker.
window.addEventListener(EVENTS.authChanged, () => {
  const path = router.current ? router.current.path : '';
  if (api.isLoggedIn || path === '/login' || path === '/profiles') return;
  router.reset('/profiles');
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

api.detectImageProxy();
api.startAutoRefresh(() => playback.active);

// Service workers need a secure context (https or localhost); plain-http LAN
// addresses skip this and run as a normal page.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

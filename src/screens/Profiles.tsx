import { h, FocusGroup, Icon, focus, toast, useState, type RouteProps } from 'zapkit-tv';
import { api, type Profile } from '../services/api';
import { history } from '../services/history';
import { Brand, Clock, HintBar, openConfirm, useDeleteKey } from '../components/ui';

const GRADIENTS = [
  'linear-gradient(135deg, #5c80f6, #a46bff)',
  'linear-gradient(135deg, #ff7a59, #ff3b8d)',
  'linear-gradient(135deg, #2fd28a, #1f8fff)',
  'linear-gradient(135deg, #ffb347, #ff5e62)',
  'linear-gradient(135deg, #00c6ff, #7b61ff)',
  'linear-gradient(135deg, #f5576c, #f093fb)',
];

function gradientOf(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[n % GRADIENTS.length];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "Who is watching" style picker: saved logins, each with its own history, plus "add". */
export function Profiles({ router, entry }: RouteProps) {
  const [list, setList] = useState<Profile[]>(() => api.listProfiles());

  const select = (p: Profile) => {
    if (!api.selectProfile(p.id)) return;
    router.reset('/');
    // Re-check the login quietly: only a rejected login signs out, network errors keep the cached one.
    api.authenticate().catch((e: Error) => {
      if (/Giriş başarısız/.test(e.message)) {
        toast('Oturum geçersiz: bilgiler değişmiş olabilir', { kind: 'error' });
        api.signOut();
      }
    });
  };

  const forget = (p: Profile) =>
    openConfirm({
      title: 'Hesabı Unut',
      message: `"${p.name}" oturumu ve bu oturuma ait kaldığın yerden verileri bu cihazdan silinecek. Sunucudaki hesabın etkilenmez; istediğin zaman tekrar ekleyebilirsin.`,
      confirmText: 'Evet, Unut',
      cancelText: 'Vazgeç',
      danger: true,
      onConfirm: () => {
        api.removeProfile(p.id);
        history.clearAccount(p.id);
        setList(api.listProfiles());
        requestAnimationFrame(() => focus.focusFirst(document.querySelector('.profiles__row')));
      },
    });

  // SİL on a profile (or its forget button) asks to forget it.
  useDeleteKey(router, entry, () => {
    const cur = focus.current;
    const el = cur && cur.closest('[data-profile]');
    const p = el && list.find((x) => x.id === el.getAttribute('data-profile'));
    if (!p) return false;
    forget(p);
    return true;
  });

  return (
    <div className="profiles">
      <div className="login__glow" />
      <div className="login__top">
        <Brand />
        <Clock withDate />
      </div>
      <div className="profiles__body">
        <h1 className="profiles__title">{list.length ? 'Oturum Seç' : 'Hoş Geldin'}</h1>
        {list.length ? null : <p className="profiles__sub">Başlamak için bir Xtream hesabı ekle.</p>}
        <FocusGroup className="profiles__row" orientation="grid" enterTo="first">
          {list.map((p, i) => (
            <div className="profile" key={p.id} data-profile={p.id}>
              <div className="profile__card" focusable focusId={'profile-' + p.id} autoFocus={i === 0} onClick={() => select(p)}>
                <div className="profile__avatar" style={{ background: gradientOf(p.id) }}>
                  {(p.name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="profile__name">{p.name}</div>
                <div className="profile__host">{hostOf(p.serverUrl)}</div>
              </div>
              <div className="profile__forget" focusable focusId={'profile-forget-' + p.id} onClick={() => forget(p)}>
                <Icon name="trash" />
                <span>Hesabı Unut</span>
              </div>
            </div>
          ))}
          <div className="profile profile--add">
            <div className="profile__card" focusable focusId="profile-add" autoFocus={!list.length} onClick={() => router.navigate('/login')}>
              <div className="profile__avatar profile__avatar--add">
                <Icon name="plus" />
              </div>
              <div className="profile__name">Oturum Ekle</div>
              <div className="profile__host">Yeni Xtream hesabı</div>
            </div>
          </div>
        </FocusGroup>
      </div>
      <HintBar
        hints={
          list.length
            ? [['◀ ▶', 'Gezin'], ['OK', 'Oturumu Aç'], ['SİL', 'Hesabı Unut'], ['GERİ', 'Çık']]
            : [['OK', 'Oturum Ekle'], ['GERİ', 'Çık']]
        }
      />
    </div>
  );
}

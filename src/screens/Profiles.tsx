import { h, FocusGroup, Icon, focus, toast, useState, type RouteProps } from 'zapkit-tv';
import { api, LoginRejected, MAX_PROFILES, profileLimitMessage, type Profile } from '../services/api';
import { history } from '../services/history';
import { Brand, Clock, HintBar, openConfirm, openNotice, useDeleteKey, useStartFocus } from '../components/ui';
import { LanguageButton } from '../components/language-switch';
import { t } from '../i18n';

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
  const [, setTick] = useState(0); // re-render after a language change

  // First focus: the first profile (or "add" when there are none), not the language switch above it.
  useStartFocus(router, entry, list.length ? 'profile-' + list[0].id : 'profile-add', list.length);

  const select = (p: Profile) => {
    if (!api.selectProfile(p.id)) return;
    router.reset('/');
    // Re-check the login quietly: only a rejected login signs out, network errors keep the cached one.
    api.authenticate().catch((e: Error) => {
      if (e instanceof LoginRejected) {
        toast(t('profiles.invalid'), { kind: 'error' });
        api.signOut();
      }
    });
  };

  const forget = (p: Profile) =>
    openConfirm({
      title: t('profiles.forget.title'),
      message: t('profiles.forget.message', { name: p.name }),
      confirmText: t('profiles.forget.confirm'),
      cancelText: t('common.cancel'),
      danger: true,
      onConfirm: () => {
        api.removeProfile(p.id);
        history.clearAccount(p.id);
        setList(api.listProfiles());
        requestAnimationFrame(() => focus.focusFirst(document.querySelector('.profiles__row')));
      },
    });

  const addProfile = () => {
    if (list.length >= MAX_PROFILES) return openNotice({ title: t('profiles.limit.title'), message: profileLimitMessage() });
    router.navigate('/login');
  };

  // Delete on a profile (or its forget button) asks to forget it.
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
        <LanguageButton onChange={() => setTick((n) => n + 1)} />
        <Clock withDate />
      </div>
      <div className="profiles__body">
        <h1 className="profiles__title">{list.length ? t('profiles.title') : t('profiles.welcome')}</h1>
        {list.length ? null : <p className="profiles__sub">{t('profiles.addFirst')}</p>}
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
              <div className="profile__actions">
                <div className="profile__edit" focusable focusId={'profile-edit-' + p.id} onClick={() => router.navigate('/login', { state: { editId: p.id } })}>
                  <Icon name="edit" />
                  <span>{t('profiles.edit')}</span>
                </div>
                <div className="profile__forget" focusable focusId={'profile-forget-' + p.id} onClick={() => forget(p)}>
                  <Icon name="trash" />
                  <span>{t('profiles.forget')}</span>
                </div>
              </div>
            </div>
          ))}
          <div className="profile profile--add">
            <div className="profile__card" focusable focusId="profile-add" autoFocus={!list.length} onClick={addProfile}>
              <div className="profile__avatar profile__avatar--add">
                <Icon name="plus" />
              </div>
              <div className="profile__name">{t('profiles.add')}</div>
              <div className="profile__host">{t('profiles.addSub')}</div>
            </div>
          </div>
        </FocusGroup>
      </div>
      <HintBar
        hints={
          list.length
            ? [['◀ ▶', t('hint.navigate')], [t('key.ok'), t('profiles.hint.open')], [t('key.del'), t('profiles.hint.forget')], [t('key.back'), t('hint.exit')]]
            : [[t('key.ok'), t('profiles.add')], [t('key.back'), t('hint.exit')]]
        }
      />
    </div>
  );
}

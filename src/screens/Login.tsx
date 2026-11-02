import { h, Button, FocusGroup, focus, useState, type RouteProps } from 'zapkit-tv';
import { api, profileLabel } from '../services/api';
import { history } from '../services/history';
import { Brand, Clock, Logo, TextField, openConfirm, openTextEntry } from '../components/ui';
import { t } from '../i18n';

type Status = { kind: 'idle' | 'busy' | 'error' | 'ok'; text: string };

/** Adds an Xtream login (server URL, username, password) as a new profile, or edits a saved one (state.editId). */
export function Login({ router, state }: RouteProps) {
  const editId = state ? (state as { editId?: string }).editId : undefined;
  const editing = editId ? api.getProfile(editId) : undefined;
  const [server, setServer] = useState(editing ? editing.serverUrl : '');
  const [user, setUser] = useState(editing ? editing.username : '');
  const [pass, setPass] = useState(editing ? editing.password : '');
  const [name, setName] = useState(editing ? profileLabel(editing.name) : '');
  const [pin, setPin] = useState(editing && editing.pin ? editing.pin : '');
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: editing ? t('login.readyEdit') : t('login.ready') });

  // Edit mode: a name change alone keeps the watch history; changed server, user or password check the new
  // login and remove the history of the old one.
  const saveEdit = async () => {
    if (!editing) return;
    // An untouched generic name keeps its stored form, so it keeps following the language.
    const edit = { name: name === profileLabel(editing.name) ? editing.name : name, serverUrl: server, username: user, password: pass, pin };
    const save = async () => {
      setStatus({ kind: 'busy', text: t('login.saving') });
      try {
        const result = await api.updateProfile(editing.id, edit);
        if (result.connectionChanged) history.clearAccount(editing.id);
        router.back();
      } catch (err) {
        setStatus({ kind: 'error', text: t('login.error', { msg: (err as Error).message || t('login.saveFailed') }) });
      }
    };
    if (!api.connectionChanged(editing, edit)) return save();
    openConfirm({
      title: t('login.changed.title'),
      message: t('login.changed.message'),
      confirmText: t('login.changed.confirm'),
      cancelText: t('common.cancel'),
      danger: true,
      onConfirm: () => void save(),
    });
  };

  const submit = async () => {
    if (status.kind === 'busy') return;
    if (!server.trim() || !user.trim() || !pass) {
      setStatus({ kind: 'error', text: t('login.missing') });
      return;
    }
    if (pin && !/^\d{4,8}$/.test(pin)) {
      setStatus({ kind: 'error', text: t('login.pin.invalid') });
      return;
    }
    // The same account keeps its own entry, so only other profiles' names count.
    if (api.isNameTaken(name, editing ? editing.id : api.profileIdFor(server, user.trim()))) {
      setStatus({ kind: 'error', text: t('error.nameTaken') });
      return;
    }
    if (editing) return saveEdit();
    setStatus({ kind: 'busy', text: t('login.connecting') });
    try {
      await api.authenticate(server, user.trim(), pass, name.trim(), pin);
      setStatus({ kind: 'ok', text: t('login.success') });
      setTimeout(() => router.reset('/'), 400);
    } catch (err) {
      setStatus({ kind: 'error', text: t('login.error', { msg: (err as Error).message || t('login.connectFailed') }) });
    }
  };

  const edit = (title: string, value: string, set: (v: string) => void, type: 'text' | 'password' | 'url', next: string) =>
    openTextEntry({
      title,
      value,
      type,
      placeholder: title,
      onSubmit: (v) => {
        set(type === 'password' ? v : v.trim());
        requestAnimationFrame(() => focus.focusById(next));
      },
    });

  return (
    <div className="login">
      <div className="login__glow" />
      <div className="login__top">
        <Brand />
        {router.stack.length > 1 ? <Button icon="arrowLeft" label={t('login.back')} focusId="login-back" onClick={() => router.back()} /> : null}
        <Clock withDate />
      </div>
      <div className="login__card">
        <div className="login__intro">
          <div className="login__logo">
            <Logo />
          </div>
          <h1>F-IPTV</h1>
          <p>{editing ? t('login.editIntro') : t('login.intro')}</p>
          <ul className="login__features">
            <li>{t('login.feature1')}</li>
            <li>{t('login.feature2')}</li>
            <li>{t('login.feature3')}</li>
          </ul>
        </div>
        <FocusGroup className="login__form" orientation="vertical" enterTo="first">
          <TextField
            label={t('login.name.label')}
            value={name}
            placeholder={t('login.name.placeholder')}
            focusId="login-name"
            icon="tag"
            autoFocus
            onOpen={() => edit(t('login.name.title'), name, (v) => setName(v.slice(0, 24)), 'text', 'login-server')}
          />
          <TextField
            label={t('login.server.label')}
            value={server}
            placeholder={t('login.server.placeholder')}
            type="url"
            focusId="login-server"
            icon="server"
            onOpen={() => edit(t('login.server.label'), server, setServer, 'url', 'login-user')}
          />
          <TextField
            label={t('login.user.label')}
            value={user}
            placeholder={t('login.user.placeholder')}
            focusId="login-user"
            icon="user"
            onOpen={() => edit(t('login.user.label'), user, setUser, 'text', 'login-pass')}
          />
          <TextField
            label={t('login.pass.label')}
            value={pass}
            placeholder={t('login.pass.placeholder')}
            type="password"
            focusId="login-pass"
            icon="lock"
            onOpen={() => edit(t('login.pass.label'), pass, setPass, 'password', 'login-pin')}
          />
          <TextField
            label={t('login.pin.label')}
            value={pin}
            placeholder={t('login.pin.placeholder')}
            type="password"
            focusId="login-pin"
            icon="lock"
            onOpen={() => edit(t('login.pin.title'), pin, (v) => setPin(v.replace(/\D/g, '').slice(0, 8)), 'password', 'login-submit')}
          />
          <Button className="login__submit" focusId="login-submit" icon={editing ? 'check' : 'login'} label={status.kind === 'busy' ? (editing ? t('login.saving') : t('login.connectingShort')) : editing ? t('login.save') : t('login.signIn')} onClick={submit} />
          <div className={['login__status', 'login__status--' + status.kind]}>{status.text}</div>
        </FocusGroup>
      </div>
    </div>
  );
}

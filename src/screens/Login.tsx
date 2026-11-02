import { h, Button, FocusGroup, focus, useState, type RouteProps } from 'zapkit-tv';
import { api } from '../services/api';
import { Brand, Clock, TextField, openTextEntry } from '../components/ui';

type Status = { kind: 'idle' | 'busy' | 'error' | 'ok'; text: string };

/** Adds an Xtream login (server URL, username, password) as a new profile. */
export function Login({ router }: RouteProps) {
  // Always a new login: saved ones are opened from the picker.
  const [server, setServer] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'Xtream sunucusuna bağlanmaya hazır.' });

  const submit = async () => {
    if (status.kind === 'busy') return;
    if (!server.trim() || !user.trim() || !pass) {
      setStatus({ kind: 'error', text: 'Lütfen Sunucu Adresi, Kullanıcı Adı ve Şifre girin.' });
      return;
    }
    // The same account keeps its own entry, so only other profiles' names count.
    if (api.isNameTaken(name, api.profileIdFor(server, user.trim()))) {
      setStatus({ kind: 'error', text: 'Bu oturum adı başka bir oturumda kullanılıyor.' });
      return;
    }
    setStatus({ kind: 'busy', text: 'Sunucuya bağlanılıyor...' });
    try {
      await api.authenticate(server, user.trim(), pass, name.trim());
      setStatus({ kind: 'ok', text: 'Giriş Başarılı!' });
      setTimeout(() => router.reset('/'), 400);
    } catch (err) {
      setStatus({ kind: 'error', text: `Hata: ${(err as Error).message || 'Bağlantı kurulamadı.'}` });
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
        {router.stack.length > 1 ? <Button icon="arrowLeft" label="Oturumlara Dön" focusId="login-back" onClick={() => router.back()} /> : null}
        <Clock withDate />
      </div>
      <div className="login__card">
        <div className="login__intro">
          <div className="login__logo">F</div>
          <h1>F-IPTV</h1>
          <p>Xtream sunucu bilgilerinle giriş yap</p>
          <ul className="login__features">
            <li>Canlı TV, filmler ve diziler tek yerde</li>
            <li>Kaldığın yerden devam et</li>
            <li>Otomatik sonraki bölüm</li>
          </ul>
        </div>
        <FocusGroup className="login__form" orientation="vertical" enterTo="first">
          <TextField
            label="Sunucu Adresi (URL)"
            value={server}
            placeholder="http://sunucu:port"
            type="url"
            focusId="login-server"
            icon="server"
            autoFocus
            onOpen={() => edit('Sunucu Adresi (URL)', server, setServer, 'url', 'login-user')}
          />
          <TextField
            label="Kullanıcı Adı"
            value={user}
            placeholder="Kullanıcı Adı Girin"
            focusId="login-user"
            icon="user"
            onOpen={() => edit('Kullanıcı Adı', user, setUser, 'text', 'login-pass')}
          />
          <TextField
            label="Şifre"
            value={pass}
            placeholder="Şifre Girin"
            type="password"
            focusId="login-pass"
            icon="lock"
            onOpen={() => edit('Şifre', pass, setPass, 'password', 'login-name')}
          />
          <TextField
            label="Oturum Adı (İsteğe Bağlı)"
            value={name}
            placeholder="Örn: Salon"
            focusId="login-name"
            icon="tag"
            onOpen={() => edit('Oturum Adı', name, (v) => setName(v.slice(0, 24)), 'text', 'login-submit')}
          />
          <Button className="login__submit" focusId="login-submit" icon="login" label={status.kind === 'busy' ? 'Bağlanıyor...' : 'Giriş Yap'} onClick={submit} />
          <div className={['login__status', 'login__status--' + status.kind]}>{status.text}</div>
        </FocusGroup>
      </div>
    </div>
  );
}

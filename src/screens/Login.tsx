import { h, Button, FocusGroup, focus, useState, type RouteProps } from 'zapkit-tv';
import { api } from '../services/api';
import { Brand, Clock, TextField, openTextEntry } from '../components/ui';

type Status = { kind: 'idle' | 'busy' | 'error' | 'ok'; text: string };

/** Xtream login: server URL, username, password. */
export function Login({ router }: RouteProps) {
  const [server, setServer] = useState(api.serverUrl || '');
  const [user, setUser] = useState(api.username || '');
  const [pass, setPass] = useState(api.password || '');
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: 'Xtream sunucusuna bağlanmaya hazır.' });

  const submit = async () => {
    if (status.kind === 'busy') return;
    if (!server.trim() || !user.trim() || !pass) {
      setStatus({ kind: 'error', text: 'Lütfen Sunucu Adresi, Kullanıcı Adı ve Şifre girin.' });
      return;
    }
    setStatus({ kind: 'busy', text: 'Sunucuya bağlanılıyor...' });
    try {
      await api.authenticate(server, user.trim(), pass);
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
            onOpen={() => edit('Şifre', pass, setPass, 'password', 'login-submit')}
          />
          <Button className="login__submit" focusId="login-submit" label={status.kind === 'busy' ? 'Bağlanıyor...' : 'Giriş Yap'} onClick={submit} />
          <div className={['login__status', 'login__status--' + status.kind]}>{status.text}</div>
        </FocusGroup>
      </div>
    </div>
  );
}

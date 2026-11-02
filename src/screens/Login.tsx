import { h, Button, FocusGroup, focus, useState, type RouteProps } from 'zapkit-tv';
import { api } from '../services/api';
import { history } from '../services/history';
import { Brand, Clock, TextField, openConfirm, openTextEntry } from '../components/ui';

type Status = { kind: 'idle' | 'busy' | 'error' | 'ok'; text: string };

/** Adds an Xtream login (server URL, username, password) as a new profile, or edits a saved one (state.editId). */
export function Login({ router, state }: RouteProps) {
  const editId = state ? (state as { editId?: string }).editId : undefined;
  const editing = editId ? api.getProfile(editId) : undefined;
  const [server, setServer] = useState(editing ? editing.serverUrl : '');
  const [user, setUser] = useState(editing ? editing.username : '');
  const [pass, setPass] = useState(editing ? editing.password : '');
  const [name, setName] = useState(editing ? editing.name : '');
  const [status, setStatus] = useState<Status>({ kind: 'idle', text: editing ? 'Değişiklikleri kaydetmeye hazır.' : 'Xtream sunucusuna bağlanmaya hazır.' });

  // Edit mode: a name change alone keeps the watch history; changed server, user or password check the new
  // login and remove the history of the old one.
  const saveEdit = async () => {
    if (!editing) return;
    const edit = { name, serverUrl: server, username: user, password: pass };
    const save = async () => {
      setStatus({ kind: 'busy', text: 'Kaydediliyor...' });
      try {
        const result = await api.updateProfile(editing.id, edit);
        if (result.connectionChanged) history.clearAccount(editing.id);
        router.back();
      } catch (err) {
        setStatus({ kind: 'error', text: `Hata: ${(err as Error).message || 'Kaydedilemedi.'}` });
      }
    };
    if (!api.connectionChanged(editing, edit)) return save();
    openConfirm({
      title: 'Bağlantı Bilgileri Değişti',
      message: 'Sunucu, kullanıcı adı veya şifre değiştiği için bu oturumun kaldığın yerden verileri silinecek. Devam etmek istiyor musun?',
      confirmText: 'Evet, Kaydet',
      cancelText: 'Vazgeç',
      danger: true,
      onConfirm: () => void save(),
    });
  };

  const submit = async () => {
    if (status.kind === 'busy') return;
    if (!server.trim() || !user.trim() || !pass) {
      setStatus({ kind: 'error', text: 'Lütfen Sunucu Adresi, Kullanıcı Adı ve Şifre girin.' });
      return;
    }
    // The same account keeps its own entry, so only other profiles' names count.
    if (api.isNameTaken(name, editing ? editing.id : api.profileIdFor(server, user.trim()))) {
      setStatus({ kind: 'error', text: 'Bu oturum adı başka bir oturumda kullanılıyor.' });
      return;
    }
    if (editing) return saveEdit();
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
          <p>{editing ? 'Oturum bilgilerini düzenle' : 'Xtream sunucu bilgilerinle giriş yap'}</p>
          <ul className="login__features">
            <li>Canlı TV, filmler ve diziler tek yerde</li>
            <li>Kaldığın yerden devam et</li>
            <li>Otomatik sonraki bölüm</li>
          </ul>
        </div>
        <FocusGroup className="login__form" orientation="vertical" enterTo="first">
          <TextField
            label="Oturum Adı (İsteğe Bağlı)"
            value={name}
            placeholder="Örn: Salon"
            focusId="login-name"
            icon="tag"
            autoFocus
            onOpen={() => edit('Oturum Adı', name, (v) => setName(v.slice(0, 24)), 'text', 'login-server')}
          />
          <TextField
            label="Sunucu Adresi (URL)"
            value={server}
            placeholder="http://sunucu:port"
            type="url"
            focusId="login-server"
            icon="server"
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
          <Button className="login__submit" focusId="login-submit" icon={editing ? 'check' : 'login'} label={status.kind === 'busy' ? (editing ? 'Kaydediliyor...' : 'Bağlanıyor...') : editing ? 'Kaydet' : 'Giriş Yap'} onClick={submit} />
          <div className={['login__status', 'login__status--' + status.kind]}>{status.text}</div>
        </FocusGroup>
      </div>
    </div>
  );
}

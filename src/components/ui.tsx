/**
 * Shared F-IPTV building blocks on top of zapkit-tv: screen-scoped keys,
 * header with clock, hint bar, category sidebar, poster cards, confirm and
 * account dialogs and the text entry sheet (native input + D-pad keyboard).
 */
import {
  h,
  Fragment,
  Button,
  FocusGroup,
  Icon,
  Image,
  Marquee,
  VirtualList,
  focus,
  openOverlay,
  overlays,
  useEffect,
  useRef,
  useState,
  type Child,
  type LogicalKey,
  type KbKeyDetail,
  type RouteEntry,
  type Router,
} from 'zapkit-tv';
import { api } from '../services/api';
import { longDate, timeOfDay } from '../services/format';
import { isTvDevice } from '../services/platform';

// ---- keys ------------------------------------------------------------------

/** The screen is the visible one and no dialog covers it. */
export function isTop(router: Router, entry: RouteEntry): boolean {
  return router.current === entry && overlays.entries.length === 0;
}

/**
 * First focus for a screen whose list is built asynchronously: focuses `focusId`
 * right after mount and again whenever `rebuilt` changes (the list remounts and
 * drops focus), until the user presses a key.
 */
export function useStartFocus(router: Router, entry: RouteEntry, focusId: string, rebuilt: unknown): void {
  const pressed = useRef(false);
  useEffect(() => {
    const onKey = () => {
      pressed.current = true;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!pressed.current && isTop(router, entry)) focus.focusById(focusId);
    }, 60);
    return () => clearTimeout(t);
  }, [rebuilt]);
}

/**
 * Global key handler that only runs while this screen is on top (keepAlive
 * screens stay mounted underneath). Return true to consume the key.
 */
export function useScreenKeys(
  router: Router,
  entry: RouteEntry,
  handler: (key: LogicalKey, detail: KbKeyDetail) => boolean | void,
  priority = 5,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => focus.onKey((key, detail) => (isTop(router, entry) ? ref.current(key, detail) : false), priority), []);
}

/**
 * The "delete" gesture: Delete/Backspace on a keyboard, d/c like the old app,
 * or the red key on a remote. Ignored while typing in a text field.
 */
export function useDeleteKey(router: Router, entry: RouteEntry, handler: () => boolean | void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop(router, entry)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Delete' || e.keyCode === 46 || /^[dDcC]$/.test(e.key)) {
        if (ref.current()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    const offRed = focus.onKey((key) => (key === 'red' && isTop(router, entry) ? !!ref.current() : false), 6);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      offRed();
    };
  }, []);
}

/** Runs `fn` for a window event while mounted. */
export function useWindowEvent(name: string, fn: (e: Event) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const listener = (e: Event) => ref.current(e);
    window.addEventListener(name, listener);
    return () => window.removeEventListener(name, listener);
  }, [name]);
}

// ---- chrome ----------------------------------------------------------------

export function Clock(props: { withDate?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <div className="clock__time">{timeOfDay(now)}</div>
      {props.withDate ? <div className="clock__date">{longDate(now)}</div> : null}
    </div>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand__mark">F</span>
      <span className="brand__name">F-IPTV</span>
    </div>
  );
}

export function ScreenHeader(props: { title: string; count?: Child; children?: Child }) {
  return (
    <header className="screen-header">
      <Brand />
      <div className="screen-header__title">
        <h1>{props.title}</h1>
        {props.count != null ? <span className="pill">{props.count}</span> : null}
      </div>
      <div className="screen-header__end">
        {props.children}
        <Clock />
      </div>
    </header>
  );
}

const ARROW_ICONS: Record<string, string> = { '◀': 'left', '▶': 'right', '▲': 'up', '▼': 'down' };

/** Remote key hints; arrow glyphs are drawn as icons (TV fonts often lack them). */
export function HintBar(props: { hints: Array<[string, string]> }) {
  return (
    <footer className="hint-bar">
      {props.hints.map(([key, label]) => (
        <span className="hint" key={key + label}>
          <kbd>
            {key.split('').map((ch, i) => (ARROW_ICONS[ch] ? <Icon key={i} name={ARROW_ICONS[ch]} /> : ch === ' ' ? null : ch))}
          </kbd>
          {label}
        </span>
      ))}
    </footer>
  );
}

export function EmptyState(props: { icon?: string; title: string; text?: string; children?: Child }) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={props.icon || 'empty'} />
      </div>
      <div className="empty__title">{props.title}</div>
      {props.text ? <div className="empty__text">{props.text}</div> : null}
      {props.children}
    </div>
  );
}

export function Loading(props: { text: string }) {
  return (
    <div className="loading">
      <div className="kb-spinner" />
      <span>{props.text}</span>
    </div>
  );
}

// ---- category sidebar ------------------------------------------------------

export interface CategoryItem {
  id: string;
  name: string;
  count?: number;
  accent?: boolean;
}

/**
 * Vertical category list. Focusing a row reports it (screens debounce the
 * actual load); Enter moves on to the content.
 */
export function CategoryList(props: {
  title: string;
  items: CategoryItem[];
  selectedId: string;
  focusPrefix: string;
  height: number;
  onFocusItem: (item: CategoryItem) => void;
  onSelect: (item: CategoryItem) => void;
  /** Right arrow: move into the content. Return true when handled (otherwise spatial navigation decides). */
  onRight?: () => boolean | void;
}) {
  const initial = Math.max(0, props.items.findIndex((c) => c.id === props.selectedId));
  return (
    <aside
      className="sidebar"
      onKbKey={(e: CustomEvent) => {
        if (e.detail.key === 'right' && props.onRight && props.onRight() === true) e.preventDefault();
      }}
    >
      <div className="sidebar__title">{props.title}</div>
      <VirtualList
        key={props.items.length + ':' + (props.items[0] ? props.items[0].id : '')}
        className="sidebar__list"
        items={props.items}
        itemSize={68}
        gap={6}
        viewportSize={props.height}
        focusPrefix={props.focusPrefix}
        initialIndex={initial}
        keyOf={(c) => c.id}
        onFocusIndex={(i) => props.onFocusItem(props.items[i])}
        onSelect={(c) => props.onSelect(c)}
        renderItem={(c) => (
          <div className={['cat', { 'cat--selected': c.id === props.selectedId, 'cat--accent': c.accent }]}>
            <span className="cat__name">{c.name}</span>
            {c.count != null ? <span className="cat__count">{c.count}</span> : null}
          </div>
        )}
      />
    </aside>
  );
}

// ---- poster card -----------------------------------------------------------

export function PosterCard(props: {
  title: string;
  image?: string;
  meta?: string;
  rating?: string;
  badge?: string;
  progress?: number;
  focused?: boolean;
}) {
  const initials = (props.title || '?').trim().slice(0, 2).toUpperCase();
  return (
    <div className="poster">
      <div className="poster__art">
        <Image src={props.image || null} className="poster__img" fallback={<div className="poster__fallback">{initials}</div>} />
        {props.rating ? <span className="poster__rating">
            <Icon name="star" /> {props.rating}
          </span> : null}
        {props.badge ? <span className="poster__badge">{props.badge}</span> : null}
        {props.progress != null && props.progress > 0 ? (
          <div className="poster__progress">
            <div style={{ width: Math.min(100, props.progress) + '%' }} />
          </div>
        ) : null}
      </div>
      <div className="poster__title">
        <Marquee text={props.title} active={!!props.focused} />
      </div>
      {props.meta ? <div className="poster__meta">{props.meta}</div> : null}
    </div>
  );
}

// ---- dialogs ---------------------------------------------------------------

export function openConfirm(opts: {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  openOverlay(
    (close) => (
      <div className="dialog" role="alertdialog">
        <div className={['dialog__icon', { 'dialog__icon--danger': opts.danger }]}>{opts.danger ? '!' : '?'}</div>
        <h2 className="dialog__title">{opts.title}</h2>
        <p className="dialog__text">{opts.message}</p>
        <FocusGroup className="dialog__actions" orientation="horizontal">
          <Button
            className={{ 'btn-danger': opts.danger }}
            label={opts.confirmText}
            onClick={() => {
              close();
              opts.onConfirm();
            }}
          />
          <Button label={opts.cancelText || 'Vazgeç'} autoFocus onClick={close} />
        </FocusGroup>
      </div>
    ),
    { className: 'overlay-dim' },
  );
}

/** A message with a single OK button. */
export function openNotice(opts: { title: string; message: string; buttonText?: string }) {
  openOverlay(
    (close) => (
      <div className="dialog" role="alertdialog">
        <div className="dialog__icon">!</div>
        <h2 className="dialog__title">{opts.title}</h2>
        <p className="dialog__text">{opts.message}</p>
        <FocusGroup className="dialog__actions" orientation="horizontal">
          <Button label={opts.buttonText || 'Tamam'} autoFocus onClick={close} />
        </FocusGroup>
      </div>
    ),
    { className: 'overlay-dim' },
  );
}

export function openAccount() {
  const u = api.user;
  const rows: Array<[string, string]> = [
    ['Kullanıcı Adı', u?.username || api.username || '-'],
    ['Durum', u?.status || '-'],
    ['Bitiş Tarihi', u?.exp_date || 'Süresiz'],
    ['Eşzamanlı Bağlantı', u ? `${u.active_cons} / ${u.max_connections}` : '-'],
    ['Sunucu Adresi', api.serverUrl || '-'],
  ];
  openOverlay(
    (close) => (
      <div className="dialog dialog--wide">
        <h2 className="dialog__title">HESAP BİLGİLERİ</h2>
        <p className="dialog__text">Xtream Codes IPTV Abonelik Detayları</p>
        <dl className="account-grid">
          {rows.map(([k, v]) => (
            <div className="account-grid__row" key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <FocusGroup className="dialog__actions" orientation="horizontal">
          <Button label="Kapat" autoFocus onClick={close} />
        </FocusGroup>
      </div>
    ),
    { className: 'overlay-dim' },
  );
}

// ---- text entry ------------------------------------------------------------

const KEY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '.'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'Ğ', 'Ü'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ş', 'İ', ':'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Ö', 'Ç', '/', '@', '_'],
];

export interface TextEntryOptions {
  title: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'url';
  /** Called on every change (live search). */
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
}

function TextEntry(props: TextEntryOptions & { close: () => void }) {
  const [value, setValue] = useState(props.value || '');
  const [upper, setUpper] = useState(props.type !== 'url' && props.type !== 'password');
  const [reveal, setReveal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (v: string) => {
    setValue(v);
    if (props.onChange) props.onChange(v);
  };
  const submit = () => {
    props.close();
    props.onSubmit(value);
  };
  const press = (k: string) => update(value + (upper ? k : k.toLocaleLowerCase('tr-TR')));

  useEffect(() => {
    // On a TV start on the D-pad keyboard; focusing the <input> pops the TV's own keyboard.
    requestAnimationFrame(() => {
      if (isTvDevice()) focus.focusById('vk-0-0');
      else if (inputRef.current) focus.focus(inputRef.current);
    });
  }, []);

  const shown = props.type === 'password' && !reveal ? 'password' : 'text';
  return (
    <div className="entry">
      <h2 className="entry__title">{props.title}</h2>
      <input
        ref={inputRef}
        className="entry__input"
        type={shown}
        value={value}
        placeholder={props.placeholder || ''}
        focusable
        focusId="vk-input"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        onInput={(e: Event) => update((e.target as HTMLInputElement).value)}
        onKbkey={(e: CustomEvent) => {
          if (e.detail.key === 'enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      {/* wrap: past an edge key the focus continues on the opposite side, in every direction */}
      <FocusGroup className="vk" orientation="grid" wrap>
        {KEY_ROWS.map((row, r) => (
          <div className="vk__row" key={r}>
            {row.map((k, c) => (
              <button
                key={k}
                type="button"
                className="vk__key"
                focusable
                focusId={`vk-${r}-${c}`}
                onClick={() => press(k)}
              >
                {upper ? k : k.toLocaleLowerCase('tr-TR')}
              </button>
            ))}
          </div>
        ))}
        <div className="vk__row vk__row--actions">
          <button type="button" className="vk__key vk__key--wide" focusable onClick={() => setUpper(!upper)}>
            {upper ? 'abc' : 'ABC'}
          </button>
          <button type="button" className="vk__key vk__key--wide" focusable onClick={() => update('')}>
            TEMİZLE
          </button>
          <button type="button" className="vk__key vk__key--space" focusable onClick={() => update(value + ' ')}>
            BOŞLUK
          </button>
          <button type="button" className="vk__key vk__key--wide" focusable onClick={() => update(value.slice(0, -1))}>
            SİL
          </button>
          {props.type === 'password' ? (
            <button type="button" className="vk__key vk__key--wide" focusable onClick={() => setReveal(!reveal)}>
              {reveal ? 'GİZLE' : 'GÖSTER'}
            </button>
          ) : null}
          <button type="button" className="vk__key vk__key--wide vk__key--ok" focusable onClick={submit}>
            TAMAM
          </button>
        </div>
      </FocusGroup>
      <div className="entry__hint">
        <kbd>GERİ</kbd> Vazgeç
      </div>
    </div>
  );
}

export function openTextEntry(opts: TextEntryOptions) {
  openOverlay((close) => <TextEntry {...opts} close={close} />, { className: 'overlay-dim overlay-entry' });
}

/** A focusable field that shows its value and opens the text entry sheet on Enter. */
export function TextField(props: {
  label?: string;
  value: string;
  placeholder: string;
  type?: 'text' | 'password' | 'url';
  focusId?: string;
  icon?: string;
  className?: unknown;
  autoFocus?: boolean;
  onOpen: () => void;
}) {
  const text = props.value ? (props.type === 'password' ? '•'.repeat(props.value.length) : props.value) : props.placeholder;
  return h(
    Fragment,
    null,
    props.label ? <label className="field__label">{props.label}</label> : null,
    <div
      className={['field', { 'field--empty': !props.value }, props.className]}
      focusable
      focusId={props.focusId}
      autoFocus={props.autoFocus}
      onClick={props.onOpen}
    >
      {props.icon ? <Icon name={props.icon} className="field__icon" /> : null}
      <span className="field__text">{text}</span>
    </div>,
  );
}

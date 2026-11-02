import { h, Button, FocusGroup, Icon, VirtualList, focus, openOverlay, useEffect } from 'zapkit-tv';
import { LANGS, getLang, setLang, t, type Lang } from '../i18n';

const ROW = 68;
const GAP = 6;
const MAX_ROWS = 6;

/** The list inside the dialog: the current language is outlined, the focused row is solid white; it scrolls with focus. */
function LanguageList(props: { onPick: (code: Lang) => void }) {
  const current = getLang();
  const index = Math.max(0, LANGS.findIndex((l) => l.code === current));
  // Start on the language in use.
  useEffect(() => {
    requestAnimationFrame(() => focus.focusById('lang-' + current));
  }, []);
  const rows = Math.min(LANGS.length, MAX_ROWS);
  return (
    <VirtualList
      className="lang-list"
      items={LANGS}
      itemSize={ROW}
      gap={GAP}
      viewportSize={rows * ROW + (rows - 1) * GAP}
      focusPrefix="lang"
      initialIndex={index}
      keyOf={(l) => l.code}
      onSelect={(l) => props.onPick(l.code)}
      renderItem={(l) => (
        <div className={['cat', { 'cat--selected': l.code === current }]}>
          <span className="cat__name">{l.name}</span>
          {l.code === current ? <Icon name="check" /> : null}
        </div>
      )}
    />
  );
}

/** Opens the language dialog. `onChange` runs after a different language was chosen so the screen can re-render. */
export function openLanguageDialog(onChange: () => void) {
  openOverlay(
    (close) => (
      <div className="dialog dialog--list" role="dialog">
        <h2 className="dialog__title">{t('lang.title')}</h2>
        <div className="dialog__list">
          <LanguageList
            onPick={(code) => {
              close();
              if (code === getLang()) return;
              setLang(code);
              onChange();
            }}
          />
        </div>
        <FocusGroup className="dialog__actions" orientation="horizontal">
          <Button label={t('common.close')} onClick={close} />
        </FocusGroup>
      </div>
    ),
    { className: 'overlay-dim' },
  );
}

/** Top-right button of the profile picker: shows the language in use ("English" / "Türkçe") and opens the language dialog. */
export function LanguageButton(props: { onChange: () => void }) {
  const current = LANGS.find((l) => l.code === getLang()) || LANGS[0];
  return <Button icon="globe" label={current.name} className="lang-btn" focusId="lang-button" onClick={() => openLanguageDialog(props.onChange)} />;
}

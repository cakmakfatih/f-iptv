import { h, Button, Image, VirtualList, focus, useEffect, useMemo, useRef, useState, useSignalValue, type RouteProps } from 'zapkit-tv';
import { Player, PlayerContext, PlayerSurface, PlayerState } from 'zapkit-tv/player';
import { api, EVENTS, type Category } from '../services/api';
import { liveSource, type LiveChannel } from '../services/media';
import { CategoryList, EmptyState, HintBar, Loading, ScreenHeader, useWindowEvent, type CategoryItem } from '../components/ui';

const ALL = 'all';
const PREVIEW_DELAY = 650;

function PreviewState({ player }: { player: Player }) {
  const state = useSignalValue(player.state);
  const error = useSignalValue(player.error);
  if (error && error.fatal) return <div className="preview__state preview__state--error">Yayın açılamadı</div>;
  if (state === PlayerState.BUFFERING || state === PlayerState.UNSTARTED) return <div className="preview__state"><div className="kb-spinner" /></div>;
  return null;
}

/** Real stream facts from the preview player (resolution appears once the video reports it). */
function useVideoSize(player: Player): string {
  const [size, setSize] = useState('');
  useEffect(() => {
    const v = player.video;
    const update = () => setSize(v.videoHeight ? v.videoHeight + 'p' : '');
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    v.addEventListener('emptied', update);
    update();
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
      v.removeEventListener('emptied', update);
    };
  }, [player]);
  return size;
}

export function Live({ router, entry }: RouteProps) {
  const [cats, setCats] = useState<CategoryItem[]>([{ id: ALL, name: 'Tüm Kanallar' }]);
  const [catId, setCatId] = useState(ALL);
  const [channels, setChannels] = useState<LiveChannel[] | null>(null);
  const [current, setCurrent] = useState<LiveChannel | null>(null);
  const preview = useMemo(() => new Player({ autoAdvance: false, persistPrefs: true }), []);
  const catTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);
  const videoSize = useVideoSize(preview);
  const previewing = useRef<string | null>(null);
  const currentRef = useRef<LiveChannel | null>(null);
  currentRef.current = current;

  const loadCats = () =>
    api.getLiveCategories().then((list: Category[]) =>
      setCats([{ id: ALL, name: 'Tüm Kanallar' }, ...list.map((c) => ({ id: String(c.category_id), name: c.category_name }))]),
    );

  const loadChannels = (id: string, keep = false) => {
    const seq = ++loadSeq.current;
    if (!keep) setChannels(null);
    api.getLiveStreams(id).then((list) => {
      if (seq !== loadSeq.current) return;
      setChannels(list);
      if (!keep && list.length) setCurrent(list[0]);
    });
  };

  const startPreview = (ch: LiveChannel | null) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (!ch) return;
    previewTimer.current = setTimeout(() => {
      if (router.current !== entry) return;
      const id = String(ch.stream_id);
      if (previewing.current === id) return;
      previewing.current = id;
      preview.load(liveSource(ch)).then(() => preview.play()).catch(() => {});
    }, PREVIEW_DELAY);
  };

  const stopPreview = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewing.current = null;
    preview.stop();
  };

  // First focus: "Tüm Kanallar", unless focus is already somewhere on this screen.
  const focusStart = () => {
    const root = document.querySelector('.screen-live');
    if (!root || router.current !== entry || (focus.current && root.contains(focus.current))) return;
    focus.focusById('live-cat-' + ALL);
  };

  useEffect(() => {
    // The category list is rebuilt when the server categories arrive, so focus again afterwards.
    requestAnimationFrame(focusStart);
    loadCats().then(() => setTimeout(focusStart, 80));
    loadChannels(ALL);
    // Pause the preview while another screen (the fullscreen player) is on top.
    const unsub = router.subscribe(() => {
      if (router.current !== entry) stopPreview();
      else startPreview(currentRef.current);
    });
    return () => {
      unsub();
      if (catTimer.current) clearTimeout(catTimer.current);
      stopPreview();
      preview.destroy();
    };
  }, []);

  useEffect(() => startPreview(current), [current]);

  useWindowEvent(EVENTS.contentUpdated, (e) => {
    const kinds: string[] = (e as CustomEvent).detail?.kinds || [];
    if (!kinds.includes('live')) return;
    loadCats();
    loadChannels(catId, true);
  });

  const selectCategory = (c: CategoryItem) => {
    if (catTimer.current) clearTimeout(catTimer.current);
    catTimer.current = setTimeout(() => {
      if (c.id === catId) return;
      setCatId(c.id);
      loadChannels(c.id);
    }, 220);
  };

  const watch = (ch: LiveChannel | null) => {
    if (!ch || !channels) return;
    const index = Math.max(0, channels.findIndex((c) => c.stream_id === ch.stream_id));
    stopPreview();
    router.navigate('/watch', { state: { kind: 'live', channels, index } });
  };

  const channelNo = current && channels ? channels.findIndex((c) => c.stream_id === current.stream_id) + 1 : 0;
  const found = current && current.category_id != null ? cats.find((c) => c.id === String(current.category_id)) : null;
  const categoryName = found ? found.name : cats.find((c) => c.id === catId && c.id !== ALL)?.name || '-';

  return (
    <div className="screen-catalog screen-live">
      <ScreenHeader title="Canlı TV" count={channels ? `${channels.length} Kanal` : 'Kanallar yükleniyor...'} />
      <CategoryList
        title="KATEGORİLER"
        items={cats}
        selectedId={catId}
        focusPrefix="live-cat"
        height={740}
        onFocusItem={selectCategory}
        onSelect={() => focus.focusFirst(document.querySelector('.screen-live .channel-list'))}
        onRight={() => focus.focusFirst(document.querySelector('.screen-live .channel-list'))}
      />
      <section className="channels">
        <div className="sidebar__title">KANALLAR</div>
        {!channels ? (
          <Loading text="Kanallar yükleniyor..." />
        ) : channels.length === 0 ? (
          <EmptyState icon="tv" title="Bu kategoride kanal yok" text="Soldan farklı bir kategori seçin." />
        ) : (
          <VirtualList
            key={'ch-' + catId}
            className="channel-list"
            items={channels}
            itemSize={88}
            gap={8}
            viewportSize={740}
            focusPrefix="channel"
            keyOf={(c) => String(c.stream_id)}
            onFocusIndex={(i) => setCurrent(channels[i])}
            onSelect={watch}
            renderItem={(c, i) => (
              <div className={['channel', { 'channel--active': current && current.stream_id === c.stream_id }]}>
                <span className="channel__num">{c.num || i + 1}</span>
                <div className="channel__logo">
                  <Image src={api.logoUrl(c.stream_icon) || null} className="channel__logo-img" fallback={<span className="channel__logo-fb">TV</span>} />
                </div>
                <div className="channel__body">
                  <div className="channel__name">{c.name || 'Bilinmeyen Kanal'}</div>
                  <div className="channel__epg">{c.epg_title || 'Canlı yayın'}</div>
                </div>
              </div>
            )}
          />
        )}
      </section>
      <aside className="preview">
        <div className="preview__screen">
          <PlayerContext.Provider value={preview}>
            <PlayerSurface className="preview__surface" />
          </PlayerContext.Provider>
          {current ? <PreviewState player={preview} /> : <div className="preview__state">Kanal Seçin</div>}
          <span className="preview__badge">
            <i /> CANLI
          </span>
          {videoSize ? <span className="preview__quality">{videoSize}</span> : null}
        </div>
        <div className="preview__info">
          <div className="preview__title">{current ? current.name : 'Kanal Seçin'}</div>
          <div className="preview__epg">{current ? current.epg_title || 'Canlı yayın akışı' : 'Listeden bir kanal seçin'}</div>
          <dl className="preview__facts">
            <div>
              <dt>KANAL NO</dt>
              <dd>{current ? current.num || channelNo : '-'}</dd>
            </div>
            <div>
              <dt>KATEGORİ</dt>
              <dd>{categoryName}</dd>
            </div>
            <div>
              <dt>ÇÖZÜNÜRLÜK</dt>
              <dd>{videoSize || '-'}</dd>
            </div>
            <div>
              <dt>AKIŞ</dt>
              <dd>HLS · Canlı</dd>
            </div>
          </dl>
          <Button icon="play" label="Tam Ekran İzle" focusId="live-fullscreen" disabled={!current} onClick={() => watch(current)} />
        </div>
      </aside>
      <HintBar hints={[['◀ ▶', 'Kategori / Kanal Listesi'], ['▲ ▼', 'Gezin & Canlı Önizle'], ['OK', 'Tam Ekranda İzle'], ['GERİ', 'Ana Ekrana Dön']]} />
    </div>
  );
}

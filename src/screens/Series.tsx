import { h, Button, VirtualList, focus, useEffect, useMemo, useRef, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS, type Category } from '../services/api';
import { history, type WatchProgressItem } from '../services/history';
import { formatRating, normalizeSearch, yearOf } from '../services/format';
import {
  CategoryList,
  EmptyState,
  HintBar,
  Loading,
  PosterCard,
  ScreenHeader,
  TextField,
  openConfirm,
  openTextEntry,
  useDeleteKey,
  useScreenKeys,
  useWindowEvent,
  type CategoryItem,
} from '../components/ui';

const CONTINUE = 'continue';
const ALL = 'all';

interface SeriesCard {
  id: string;
  name: string;
  cover: string;
  rating: string;
  meta: string;
  genre: string;
  progress?: number;
  resume?: WatchProgressItem;
  raw?: any;
}

function fromSeries(s: any, progress: Map<string, number>): SeriesCard {
  const id = String(s.series_id);
  const year = yearOf(s);
  return {
    id,
    name: s.name || 'Dizi',
    cover: s.cover || api.getCachedCover(id),
    rating: formatRating(s.rating),
    genre: s.genre || '',
    meta: [year, s.genre].filter(Boolean).join(' • '),
    progress: progress.get(id),
    raw: s,
  };
}

function fromContinue(it: WatchProgressItem): SeriesCard {
  const id = String(it.seriesId);
  return {
    id,
    name: it.seriesName || it.title,
    cover: it.cover || api.getCachedCover(id),
    rating: '',
    genre: '',
    meta: `Sezon ${it.seasonNum || 1} • Bölüm ${it.episodeNum || 1}`,
    progress: it.progressPercent,
    resume: it,
  };
}

export function Series({ router, entry }: RouteProps) {
  const [serverCats, setServerCats] = useState<Category[]>([]);
  const [continueList, setContinueList] = useState<WatchProgressItem[]>(() => history.getSeriesContinueList());
  const [catId, setCatId] = useState(() => (history.getSeriesContinueList().length ? CONTINUE : ALL));
  const [series, setSeries] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const [covers, setCovers] = useState<Record<string, string>>({});
  const catTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);
  const pendingReload = useRef(false);
  const focusedCard = useRef<SeriesCard | null>(null);

  const loadCats = () => api.getSeriesCategories().then(setServerCats);
  const loadSeries = (id: string, keep = false) => {
    if (id === CONTINUE) return;
    const seq = ++loadSeq.current;
    if (!keep) setSeries(null);
    api.getSeriesList(id).then((list) => {
      if (seq === loadSeq.current) setSeries(list);
    });
  };

  useEffect(() => {
    loadCats();
    loadSeries(catId === CONTINUE ? ALL : catId);
    const unsub = router.subscribe(() => {
      // Content changed while the detail screen was open: apply it on return.
      if (router.current === entry && pendingReload.current) {
        pendingReload.current = false;
        loadCats();
        loadSeries(catId, true);
      }
    });
    return () => {
      unsub();
      if (catTimer.current) clearTimeout(catTimer.current);
    };
  }, []);

  useWindowEvent(EVENTS.historyUpdated, () => setContinueList(history.getSeriesContinueList()));
  useWindowEvent(EVENTS.contentUpdated, (e) => {
    const kinds: string[] = (e as CustomEvent).detail?.kinds || [];
    if (!kinds.includes('series')) return;
    if (router.current !== entry) {
      pendingReload.current = true;
      return;
    }
    loadCats();
    loadSeries(catId, true);
  });

  // Continue items saved without a cover: fetch it once from the series info.
  useEffect(() => {
    for (const it of continueList) {
      const id = String(it.seriesId);
      if (it.cover || api.getCachedCover(id) || covers[id]) continue;
      api.getSeriesInfo(id).then((info) => {
        const cover = info?.info?.cover;
        if (cover) setCovers((c) => ({ ...c, [id]: cover }));
      });
    }
  }, [continueList]);

  const cats: CategoryItem[] = useMemo(() => {
    const list: CategoryItem[] = [];
    if (continueList.length) list.push({ id: CONTINUE, name: `Kaldığın Yerden (${continueList.length})`, accent: true });
    list.push({ id: ALL, name: 'Tüm Diziler' });
    for (const c of serverCats) list.push({ id: String(c.category_id), name: c.category_name });
    return list;
  }, [serverCats, continueList.length]);

  // Leaving the continue category when it empties.
  useEffect(() => {
    if (catId === CONTINUE && !continueList.length) {
      setCatId(ALL);
      loadSeries(ALL);
    }
  }, [continueList.length]);

  const cards: SeriesCard[] | null = useMemo(() => {
    let list: SeriesCard[] | null;
    if (catId === CONTINUE) {
      list = continueList.map(fromContinue).map((c) => (c.cover ? c : { ...c, cover: covers[c.id] || '' }));
    } else if (!series) {
      list = null;
    } else {
      const progress = new Map<string, number>();
      for (const it of continueList) progress.set(String(it.seriesId), it.progressPercent);
      list = series.map((s) => fromSeries(s, progress));
    }
    const q = normalizeSearch(query.trim());
    if (list && q) list = list.filter((c) => normalizeSearch(c.name).includes(q) || normalizeSearch(c.genre).includes(q));
    return list;
  }, [catId, series, continueList, covers, query]);

  const selectCategory = (c: CategoryItem) => {
    if (catTimer.current) clearTimeout(catTimer.current);
    catTimer.current = setTimeout(() => {
      if (c.id === catId) return;
      setCatId(c.id);
      loadSeries(c.id);
    }, 220);
  };

  const focusGrid = () => focus.focusFirst(document.querySelector('.screen-series .catalog-grid'));

  const openSearch = () =>
    openTextEntry({
      title: 'Dizi Ara (İsim veya Tür)',
      value: query,
      placeholder: 'Dizi ara... (Örn: Garcia, Taht Oyunları, Aile)',
      onChange: setQuery,
      onSubmit: (v) => {
        setQuery(v.trim());
        requestAnimationFrame(() => {
          if (!focusGrid()) focus.focusById('series-search');
        });
      },
    });

  const open = (c: SeriesCard) => {
    if (c.resume) {
      const it = c.resume;
      router.navigate('/watch', {
        state: {
          kind: 'series',
          seriesId: c.id,
          seriesName: c.name,
          episodeId: String(it.episodeId),
          cover: c.cover,
          startTime: it.currentTime || 0,
        },
      });
      return;
    }
    router.navigate('/series/' + encodeURIComponent(c.id), { state: { series: c.raw } });
  };

  const clearAll = () =>
    openConfirm({
      title: 'Kaldığın Yerden Listesini Temizle',
      message: 'Kaldığınız yerden devam etme listenizdeki tüm diziler ve izleme geçmişiniz silinecektir. Bu işlem geri alınamaz.',
      confirmText: 'Evet, Temizle',
      cancelText: 'Vazgeç',
      danger: true,
      onConfirm: () => {
        history.clearSeriesHistory();
        requestAnimationFrame(() => focus.focusById('series-search'));
      },
    });

  useScreenKeys(router, entry, (key) => {
    if (key === 'back' && query) {
      setQuery('');
      return true;
    }
    return false;
  });

  useDeleteKey(router, entry, () => {
    const cur = focus.current;
    if (!cur) return false;
    if (cur.closest('.catalog__bar')) {
      if (query) {
        setQuery('');
        return true;
      }
      if (catId === CONTINUE) {
        clearAll();
        return true;
      }
      return false;
    }
    const card = focusedCard.current;
    if (catId === CONTINUE && card && cur.closest('.catalog-grid')) {
      openConfirm({
        title: 'Diziyi Geçmişten Kaldır',
        message: `"${card.name}" dizisini kaldığın yerden listesinden silmek istiyor musunuz?`,
        confirmText: 'Kaldır',
        cancelText: 'Vazgeç',
        danger: true,
        onConfirm: () => history.clearSeriesItem(card.id),
      });
      return true;
    }
    if (catId === CONTINUE) {
      clearAll();
      return true;
    }
    return false;
  });

  const catName = (cats.find((c) => c.id === catId) || cats[0]).name;
  const isContinue = catId === CONTINUE;
  return (
    <div className="screen-catalog screen-series">
      <ScreenHeader title="Diziler" count={cards ? `${cards.length} Dizi` : 'Yükleniyor...'} />
      <CategoryList
        title="KATEGORİLER"
        items={cats}
        selectedId={catId}
        focusPrefix="series-cat"
        height={740}
        onFocusItem={selectCategory}
        onSelect={() => focus.focusById('series-search')}
        onRight={focusGrid}
      />
      <main className="catalog">
        <div className="catalog__bar">
          <TextField
            value={query}
            placeholder="Dizi ara..."
            icon="search"
            focusId="series-search"
            className="catalog__search"
            onOpen={openSearch}
          />
          {isContinue ? <Button icon="stop" label="Listeyi Temizle" className="btn-danger-soft" focusId="series-clear" onClick={clearAll} /> : null}
          <div className="catalog__crumb">
            {catName}
            {query ? <span className="catalog__query">“{query}” · GERİ ile temizle</span> : null}
          </div>
        </div>
        {!cards ? (
          <Loading text="Diziler yükleniyor..." />
        ) : cards.length === 0 ? (
          query ? (
            <EmptyState icon="search" title="Sonuç bulunamadı" text="Farklı bir arama terimi deneyin veya diğer kategorilere göz atın." />
          ) : isContinue ? (
            <EmptyState
              icon="history"
              title="Kaldığın yerden devam et"
              text="İzlemeye başladığınız dizi bölümleri otomatik olarak bu alana kaydedilir ve kaldığınız dakikadan devam edebilirsiniz."
            />
          ) : (
            <EmptyState icon="series" title="Bu kategoride dizi yok" text="Farklı bir arama terimi deneyin veya diğer kategorilere göz atın." />
          )
        ) : (
          <VirtualList
            key={catId + '|' + query + '|' + (isContinue ? cards.length : '')}
            className="catalog-grid"
            align="start"
            items={cards}
            columns={6}
            columnSize={208}
            itemSize={360}
            gap={20}
            viewportSize={700}
            focusPrefix="series"
            keyOf={(c) => c.id}
            onFocusIndex={(i) => (focusedCard.current = cards[i])}
            onSelect={open}
            renderItem={(c, i, st) => {
              if (st.focused) focusedCard.current = c;
              return (
                <PosterCard
                  title={c.name}
                  image={c.cover}
                  rating={c.rating}
                  meta={c.meta}
                  progress={c.progress}
                  badge={isContinue ? 'DEVAM' : i < 0 ? '' : undefined}
                  focused={st.focused}
                />
              );
            }}
          />
        )}
      </main>
      <HintBar
        hints={[
          ['OK', isContinue ? 'Kaldığın Yerden Oynat' : 'Sezon ve Bölümleri Aç'],
          ['SİL', isContinue ? 'Listeden Kaldır' : 'Aramayı Temizle'],
          ['GERİ', 'Ana Menüye Dön'],
        ]}
      />
    </div>
  );
}

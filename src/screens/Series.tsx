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
  useStartFocus,
  useWindowEvent,
  type CategoryItem,
} from '../components/ui';
import { t } from '../i18n';
import { GRID, GRID_CLASS } from '../components/grid';

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
    name: s.name || t('common.series'),
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
    meta: t('series.meta.episode', { s: it.seasonNum || 1, e: it.episodeNum || 1 }),
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
    if (continueList.length) list.push({ id: CONTINUE, name: t('series.continue', { n: continueList.length }), accent: true });
    list.push({ id: ALL, name: t('series.all') });
    for (const c of serverCats) list.push({ id: String(c.category_id), name: c.category_name });
    return list;
  }, [serverCats, continueList.length]);

  // First focus: the first category (the list is rebuilt once the server categories arrive).
  useStartFocus(router, entry, 'series-cat-' + cats[0].id, cats.length + ':' + cats[0].id);

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
      title: t('series.search.title'),
      value: query,
      placeholder: t('series.search.hint'),
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
      title: t('series.clear.title'),
      message: t('series.clear.message'),
      confirmText: t('common.yesClear'),
      cancelText: t('common.cancel'),
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
        title: t('series.remove.title'),
        message: t('series.remove.message', { name: card.name }),
        confirmText: t('common.remove'),
        cancelText: t('common.cancel'),
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
      <ScreenHeader title={t('home.series.title')} count={cards ? t('series.count', { n: cards.length }) : t('common.loading')} />
      <CategoryList
        title={t('common.categories')}
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
            placeholder={t('series.search.placeholder')}
            icon="search"
            focusId="series-search"
            className="catalog__search"
            onOpen={openSearch}
          />
          {isContinue ? <Button icon="trash" label={t('common.clearList')} className="btn-danger-soft" focusId="series-clear" onClick={clearAll} /> : null}
          <div className="catalog__crumb">
            {catName}
            {query ? <span className="catalog__query">{t('common.clearWithBack', { q: query })}</span> : null}
          </div>
        </div>
        {!cards ? (
          <Loading text={t('series.loading')} />
        ) : cards.length === 0 ? (
          query ? (
            <EmptyState icon="search" title={t('common.noResults')} text={t('common.noResultsText')} />
          ) : isContinue ? (
            <EmptyState
              icon="history"
              title={t('series.emptyContinue.title')}
              text={t('series.emptyContinue.text')}
            />
          ) : (
            <EmptyState icon="series" title={t('series.empty.title')} text={t('common.noResultsText')} />
          )
        ) : (
          <VirtualList
            key={catId + '|' + query + '|' + (isContinue ? cards.length : '')}
            className={GRID_CLASS}
            align="start"
            items={cards}
            {...GRID}
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
                  badge={isContinue ? t('series.badge.continue') : i < 0 ? '' : undefined}
                  focused={st.focused}
                />
              );
            }}
          />
        )}
      </main>
      <HintBar
        hints={[
          [t('key.ok'), isContinue ? t('series.hint.resume') : t('series.hint.open')],
          [t('key.del'), isContinue ? t('series.hint.removeFromList') : t('series.hint.clearSearch')],
          [t('key.back'), t('hint.mainMenu')],
        ]}
      />
    </div>
  );
}

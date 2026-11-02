import { h, VirtualList, focus, useEffect, useMemo, useRef, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS, type Category } from '../services/api';
import { history, type WatchProgressItem } from '../services/history';
import { formatClock, formatRating, normalizeSearch, yearOf } from '../services/format';
import { t } from '../i18n';
import { GRID, GRID_CLASS } from '../components/grid';
import { ListEditButton, confirmRemoveEntries, entryKey, useListEditing } from '../components/list-edit';
import {
  CategoryList,
  EmptyState,
  HintBar,
  Loading,
  PosterCard,
  ScreenHeader,
  TextField,
  openTextEntry,
  useDeleteKey,
  useScreenKeys,
  useStartFocus,
  useWindowEvent,
  type CategoryItem,
} from '../components/ui';

const CONTINUE = 'continue';
const ALL = 'all';

interface MovieCard {
  key: string;
  title: string;
  image: string;
  rating: string;
  meta: string;
  progress?: number;
  /** Set on a Continue Watching entry. */
  resume?: WatchProgressItem;
  raw?: any;
}

function fromMovie(m: any): MovieCard {
  return {
    key: String(m.stream_id),
    title: m.name || m.title || t('common.movie'),
    image: api.normalizeImageUrl(m.stream_icon),
    rating: formatRating(m.rating_5based ? Number(m.rating_5based) * 2 : m.rating),
    meta: [yearOf(m), (m.container_extension || '').toUpperCase()].filter(Boolean).join(' • '),
    raw: m,
  };
}

function fromContinue(it: WatchProgressItem): MovieCard {
  return {
    key: it.contentId,
    title: it.title,
    image: it.cover || '',
    rating: '',
    meta: t('movies.meta.resume', { t: formatClock(it.currentTime) }),
    progress: it.progressPercent,
    resume: it,
  };
}

export function Movies({ router, entry }: RouteProps) {
  const [serverCats, setServerCats] = useState<CategoryItem[]>([]);
  const [continueList, setContinueList] = useState<WatchProgressItem[]>(() => history.getVodContinueList());
  const [catId, setCatId] = useState(() => (history.getVodContinueList().length ? CONTINUE : ALL));
  const [movies, setMovies] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);
  // Edit mode of the Continue Watching category: OK checks cards, Delete removes the checked ones.
  const edit = useListEditing(router, entry);

  const loadCats = () =>
    api.getVodCategories().then((list: Category[]) => setServerCats(list.map((c) => ({ id: String(c.category_id), name: c.category_name }))));

  const loadMovies = (id: string, keep = false) => {
    if (id === CONTINUE) return;
    const seq = ++loadSeq.current;
    if (!keep) setMovies(null);
    api.getVodStreams(id).then((list) => {
      if (seq === loadSeq.current) setMovies(list);
    });
  };

  useEffect(() => {
    loadCats();
    loadMovies(catId === CONTINUE ? ALL : catId);
    return () => debounce.current && clearTimeout(debounce.current);
  }, []);

  useWindowEvent(EVENTS.historyUpdated, () => setContinueList(history.getVodContinueList()));

  useWindowEvent(EVENTS.contentUpdated, (e) => {
    const kinds: string[] = (e as CustomEvent).detail?.kinds || [];
    if (!kinds.includes('vod')) return;
    loadCats();
    loadMovies(catId, true);
  });

  const selectCategory = (c: CategoryItem) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (c.id === catId) return;
      edit.stop();
      setQuery('');
      setCatId(c.id);
      loadMovies(c.id);
    }, 220);
  };

  const cats: CategoryItem[] = useMemo(() => {
    const list: CategoryItem[] = [];
    if (continueList.length) list.push({ id: CONTINUE, name: t('movies.continue', { n: continueList.length }), accent: true });
    list.push({ id: ALL, name: t('movies.all') });
    return list.concat(serverCats);
  }, [serverCats, continueList.length]);

  // First focus: the first category (the list is rebuilt once the server categories arrive).
  useStartFocus(router, entry, 'movies-cat-' + cats[0].id, cats.length + ':' + cats[0].id);

  // Leaving the continue category when it empties.
  useEffect(() => {
    if (catId === CONTINUE && !continueList.length) {
      edit.stop();
      setCatId(ALL);
      loadMovies(ALL);
    }
  }, [continueList.length]);

  const isContinue = catId === CONTINUE;
  const filtered: MovieCard[] | null = useMemo(() => {
    let list: MovieCard[] | null;
    if (isContinue) list = continueList.map(fromContinue);
    else list = movies ? movies.map(fromMovie) : null;
    const q = normalizeSearch(query.trim());
    if (list && q) list = list.filter((c) => normalizeSearch(c.title).includes(q));
    return list;
  }, [isContinue, movies, continueList, query]);

  const openSearch = () =>
    openTextEntry({
      title: t('movies.search.title'),
      value: query,
      placeholder: t('movies.search.placeholder'),
      onChange: setQuery,
      onSubmit: (v) => {
        setQuery(v.trim());
        requestAnimationFrame(() => {
          if (!focus.focusFirst(document.querySelector('.screen-movies .catalog-grid'))) focus.focusById('movies-search');
        });
      },
    });

  const play = (c: MovieCard) => {
    const it = c.resume;
    if (!it) return router.navigate('/watch', { state: { kind: 'vod', movie: c.raw } });
    // contentId is "vod_<stream id>"; the player rebuilds that id from the plain stream id, so pass the plain one
    // (otherwise the saved position is not found and a second, duplicate history entry is created).
    router.navigate('/watch', {
      state: {
        kind: 'vod',
        movie: { stream_id: it.contentId.replace(/^vod_/, ''), name: it.title, stream_url: it.streamUrl, stream_icon: it.cover },
        startTime: it.currentTime || 0,
      },
    });
  };

  const focusGrid = () => focus.focusFirst(document.querySelector('.screen-movies .catalog-grid'));
  const startEditing = () => {
    edit.start();
    requestAnimationFrame(focusGrid);
  };
  const stopEditing = () => {
    edit.stop();
    requestAnimationFrame(() => focus.focusById('movies-list-edit'));
  };
  const deleteChecked = () =>
    confirmRemoveEntries(
      continueList.filter((it) => edit.has(entryKey(it))),
      stopEditing,
    );

  useScreenKeys(router, entry, (key) => {
    if (key === 'back' && edit.editing) {
      stopEditing();
      return true;
    }
    if (key === 'back' && query) {
      setQuery('');
      return true;
    }
    return false;
  });

  // Delete (or the red key) removes the checked cards while editing.
  useDeleteKey(router, entry, () => {
    if (!edit.editing) return false;
    deleteChecked();
    return true;
  });

  const catName = (cats.find((c) => c.id === catId) || cats[0]).name;
  return (
    <div className="screen-catalog screen-movies">
      <ScreenHeader title={t('home.vod.title')} count={filtered ? t('movies.count', { n: filtered.length }) : t('common.loading')} />
      <CategoryList
        title={t('movies.genres')}
        items={cats}
        selectedId={catId}
        focusPrefix="movies-cat"
        height={740}
        onFocusItem={selectCategory}
        onSelect={() => focus.focusById('movies-search')}
        onRight={focusGrid}
      />
      <main className="catalog">
        <div className="catalog__bar">
          <TextField
            value={query}
            placeholder={t('movies.search.placeholder')}
            icon="search"
            focusId="movies-search"
            className="catalog__search"
            onOpen={openSearch}
          />
          {isContinue && continueList.length ? (
            <ListEditButton editing={edit.editing} count={edit.count} focusId="movies-list-edit" onEdit={startEditing} onDelete={deleteChecked} onCancel={stopEditing} />
          ) : null}
          <div className="catalog__crumb">
            {catName}
            {query ? <span className="catalog__query">{t('common.clearWithBack', { q: query })}</span> : null}
          </div>
        </div>
        {!filtered ? (
          <Loading text={t('movies.loading')} />
        ) : filtered.length === 0 ? (
          query ? (
            <EmptyState icon="search" title={t('common.noResults')} text={t('common.noResultsText')} />
          ) : isContinue ? (
            <EmptyState icon="history" title={t('movies.emptyContinue.title')} text={t('movies.emptyContinue.text')} />
          ) : (
            <EmptyState
              icon="play"
              title={t('movies.empty.title')}
              text={t('movies.empty.text')}
            />
          )
        ) : (
          <VirtualList
            key={catId + '|' + query + '|' + (isContinue ? filtered.length : '')}
            className={GRID_CLASS}
            align="start"
            items={filtered}
            {...GRID}
            focusPrefix="movie"
            keyOf={(c) => c.key}
            onSelect={(c) => (edit.editing ? edit.toggle(c.key) : play(c))}
            renderItem={(c, _i, st) => (
              <PosterCard
                title={c.title}
                image={c.image}
                rating={c.rating}
                meta={c.meta}
                progress={c.progress}
                badge={isContinue ? t('movies.badge.continue') : undefined}
                focused={st.focused}
                selectable={isContinue && edit.editing}
                selected={edit.has(c.key)}
              />
            )}
          />
        )}
      </main>
      <HintBar
        hints={
          edit.editing
            ? [
                [t('key.ok'), t('edit.hint.toggle')],
                [t('key.del'), t('edit.hint.delete')],
                [t('key.back'), t('common.cancel')],
              ]
            : [
                ['◀ ▶', t('movies.hint.lists')],
                ['▲ ▼', t('hint.browse')],
                [t('key.ok'), isContinue ? t('movies.hint.resume') : t('movies.hint.play')],
                [t('key.back'), t('hint.home')],
              ]
        }
      />
    </div>
  );
}

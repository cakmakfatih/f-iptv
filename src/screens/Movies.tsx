import { h, VirtualList, focus, useEffect, useMemo, useRef, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS, type Category } from '../services/api';
import { formatRating, normalizeSearch, yearOf } from '../services/format';
import { t } from '../i18n';
import { GRID, GRID_CLASS } from '../components/grid';
import {
  CategoryList,
  EmptyState,
  HintBar,
  Loading,
  PosterCard,
  ScreenHeader,
  TextField,
  openTextEntry,
  useScreenKeys,
  useStartFocus,
  useWindowEvent,
  type CategoryItem,
} from '../components/ui';

const ALL = 'all';

export function Movies({ router, entry }: RouteProps) {
  const [cats, setCats] = useState<CategoryItem[]>([{ id: ALL, name: t('movies.all') }]);
  const [catId, setCatId] = useState(ALL);
  const [movies, setMovies] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);

  const loadCats = () =>
    api.getVodCategories().then((list: Category[]) =>
      setCats([{ id: ALL, name: t('movies.all') }, ...list.map((c) => ({ id: String(c.category_id), name: c.category_name }))]),
    );

  const loadMovies = (id: string, keep = false) => {
    const seq = ++loadSeq.current;
    if (!keep) setMovies(null);
    api.getVodStreams(id).then((list) => {
      if (seq === loadSeq.current) setMovies(list);
    });
  };

  useEffect(() => {
    loadCats();
    loadMovies(ALL);
    return () => debounce.current && clearTimeout(debounce.current);
  }, []);

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
      setCatId(c.id);
      loadMovies(c.id);
    }, 220);
  };

  useStartFocus(router, entry, 'movies-cat-' + cats[0].id, cats.length);

  const filtered = useMemo(() => {
    if (!movies) return null;
    const q = normalizeSearch(query.trim());
    return q ? movies.filter((m) => normalizeSearch(m.name || m.title || '').includes(q)) : movies;
  }, [movies, query]);

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

  const play = (m: any) => router.navigate('/watch', { state: { kind: 'vod', movie: m } });

  useScreenKeys(router, entry, (key) => {
    if (key === 'back' && query) {
      setQuery('');
      return true;
    }
    return false;
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
        onRight={() => focus.focusFirst(document.querySelector('.screen-movies .catalog-grid'))}
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
          ) : (
            <EmptyState
              icon="play"
              title={t('movies.empty.title')}
              text={t('movies.empty.text')}
            />
          )
        ) : (
          <VirtualList
            key={catId + '|' + query}
            className={GRID_CLASS}
            align="start"
            items={filtered}
            {...GRID}
            focusPrefix="movie"
            keyOf={(m) => String(m.stream_id)}
            onSelect={play}
            renderItem={(m, _i, st) => (
              <PosterCard
                title={m.name || m.title || t('common.movie')}
                image={api.normalizeImageUrl(m.stream_icon)}
                rating={formatRating(m.rating_5based ? Number(m.rating_5based) * 2 : m.rating)}
                meta={[yearOf(m), (m.container_extension || '').toUpperCase()].filter(Boolean).join(' • ')}
                focused={st.focused}
              />
            )}
          />
        )}
      </main>
      <HintBar hints={[['◀ ▶', t('movies.hint.lists')], ['▲ ▼', t('hint.browse')], [t('key.ok'), t('movies.hint.play')], [t('key.back'), t('hint.home')]]} />
    </div>
  );
}

import { h, VirtualList, focus, useEffect, useMemo, useRef, useState, type RouteProps } from 'zapkit-tv';
import { api, EVENTS, type Category } from '../services/api';
import { formatRating, normalizeSearch, yearOf } from '../services/format';
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
  useWindowEvent,
  type CategoryItem,
} from '../components/ui';

const ALL = 'all';

export function Movies({ router, entry }: RouteProps) {
  const [cats, setCats] = useState<CategoryItem[]>([{ id: ALL, name: 'Tüm Filmler' }]);
  const [catId, setCatId] = useState(ALL);
  const [movies, setMovies] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);

  const loadCats = () =>
    api.getVodCategories().then((list: Category[]) =>
      setCats([{ id: ALL, name: 'Tüm Filmler' }, ...list.map((c) => ({ id: String(c.category_id), name: c.category_name }))]),
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

  const filtered = useMemo(() => {
    if (!movies) return null;
    const q = normalizeSearch(query.trim());
    return q ? movies.filter((m) => normalizeSearch(m.name || m.title || '').includes(q)) : movies;
  }, [movies, query]);

  const openSearch = () =>
    openTextEntry({
      title: 'Film Ara',
      value: query,
      placeholder: 'Film ara...',
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
      <ScreenHeader title="Filmler" count={filtered ? `${filtered.length} Film` : 'Yükleniyor...'} />
      <CategoryList
        title="TÜRLER"
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
            placeholder="Film ara..."
            icon="search"
            focusId="movies-search"
            className="catalog__search"
            onOpen={openSearch}
          />
          <div className="catalog__crumb">
            {catName}
            {query ? <span className="catalog__query">“{query}” · GERİ ile temizle</span> : null}
          </div>
        </div>
        {!filtered ? (
          <Loading text="Filmler yükleniyor..." />
        ) : filtered.length === 0 ? (
          query ? (
            <EmptyState icon="search" title="Sonuç bulunamadı" text="Farklı bir arama terimi deneyin veya diğer kategorilere göz atın." />
          ) : (
            <EmptyState
              icon="play"
              title="Henüz Film Eklenmedi"
              text="Sunucunuzda şu anda kayıtlı film (VOD) bulunamadı. Dizi ve film içerikleri farklı kategorilerde yer almaktadır."
            />
          )
        ) : (
          <VirtualList
            key={catId + '|' + query}
            className="catalog-grid"
            align="start"
            items={filtered}
            columns={6}
            columnSize={208}
            itemSize={360}
            gap={20}
            viewportSize={700}
            focusPrefix="movie"
            keyOf={(m) => String(m.stream_id)}
            onSelect={play}
            renderItem={(m, _i, st) => (
              <PosterCard
                title={m.name || m.title || 'Film'}
                image={api.normalizeImageUrl(m.stream_icon)}
                rating={formatRating(m.rating_5based ? Number(m.rating_5based) * 2 : m.rating)}
                meta={[yearOf(m), (m.container_extension || '').toUpperCase()].filter(Boolean).join(' • ')}
                focused={st.focused}
              />
            )}
          />
        )}
      </main>
      <HintBar hints={[['◀ ▶', 'Kategori / Film Listesi'], ['▲ ▼', 'Gezin'], ['OK', 'Seç / Oynat'], ['GERİ', 'Ana Ekrana Dön']]} />
    </div>
  );
}

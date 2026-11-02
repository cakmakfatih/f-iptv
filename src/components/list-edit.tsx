/**
 * Edit mode of the "continue watching" lists (home, series and movies): an Edit button turns the
 * cards into check-able items, a Delete button asks for confirmation and removes what is checked.
 */
import { h, Button, useEffect, useState, type RouteEntry, type Router } from 'zapkit-tv';
import { history, type WatchProgressItem } from '../services/history';
import { openConfirm } from './ui';
import { t } from '../i18n';

/** Selection key of a list entry: a series counts once, whichever episode it shows. */
export function entryKey(it: WatchProgressItem): string {
  return it.streamType === 'series' && it.seriesId != null ? 'series_' + it.seriesId : it.contentId;
}

/** Edit mode state: which entries are checked. Leaving the screen (it stays mounted underneath) ends edit mode. */
export function useListEditing(router: Router, entry: RouteEntry) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(
    () =>
      router.subscribe(() => {
        if (router.current !== entry) {
          setSelected([]);
          setEditing(false);
        }
      }),
    [],
  );
  return {
    editing,
    count: selected.length,
    has: (key: string) => selected.indexOf(key) >= 0,
    toggle: (key: string) => setSelected((cur) => (cur.indexOf(key) >= 0 ? cur.filter((k) => k !== key) : [...cur, key])),
    start: () => {
      setSelected([]);
      setEditing(true);
    },
    stop: () => {
      setSelected([]);
      setEditing(false);
    },
  };
}

/** Asks before removing the checked entries from the history (shared by every list). */
export function confirmRemoveEntries(items: WatchProgressItem[], onDone: () => void): void {
  if (!items.length) return;
  openConfirm({
    title: t('edit.removeTitle'),
    message: items.length === 1 ? t('edit.removeOne', { name: items[0].seriesName || items[0].title }) : t('edit.removeMany', { n: items.length }),
    confirmText: t('common.remove'),
    cancelText: t('common.cancel'),
    danger: true,
    onConfirm: () => {
      history.removeMany(items);
      onDone();
    },
  });
}

/**
 * The one button of a list header, Edit List (natural width); while editing it is a fixed width and reads Delete once something is
 * checked (and asks first) and Cancel while nothing is (and just leaves edit mode).
 */
export function ListEditButton(props: { editing: boolean; count: number; focusId: string; onEdit: () => void; onDelete: () => void; onCancel: () => void }) {
  const deleting = props.editing && props.count > 0;
  return (
    <Button
      icon={!props.editing ? 'edit' : deleting ? 'trash' : 'close'}
      label={!props.editing ? t('edit.edit') : deleting ? t('edit.delete') : t('common.cancel')}
      className={[{ 'btn-list-edit': props.editing, 'btn-danger-soft': deleting }]}
      focusId={props.focusId}
      onClick={!props.editing ? props.onEdit : deleting ? props.onDelete : props.onCancel}
    />
  );
}

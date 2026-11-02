import { registerStrokeIcons } from 'zapkit-tv';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleUserRound,
  Clapperboard,
  Film,
  Globe,
  History,
  Inbox,
  Lock,
  LogIn,
  Maximize,
  Pencil,
  Plus,
  Radio,
  RotateCw,
  Search,
  Server,
  Star,
  Tag,
  Trash2,
  Tv,
  User,
  Users,
  X,
  type IconNode,
} from 'lucide';

/*
 * App icons from the Lucide set (ISC), drawn as outlines. TV fonts often lack
 * symbol glyphs such as ⌕ or ◀, which then render as empty boxes, so icons
 * never rely on text. The player keeps the SDK's own filled transport icons.
 */
const markup = (node: IconNode) =>
  node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');

const set: Record<string, IconNode> = {
  search: Search,
  server: Server,
  user: User,
  lock: Lock,
  tv: Tv,
  series: Clapperboard,
  film: Film,
  globe: Globe,
  radio: Radio,
  history: History,
  alert: CircleAlert,
  empty: Inbox,
  trash: Trash2,
  plus: Plus,
  users: Users,
  account: CircleUserRound,
  close: X,
  aspect: Maximize,
  refresh: RotateCw,
  login: LogIn,
  arrowLeft: ArrowLeft,
  left: ChevronLeft,
  right: ChevronRight,
  up: ChevronUp,
  down: ChevronDown,
  star: Star,
  tag: Tag,
  edit: Pencil,
};

registerStrokeIcons(Object.fromEntries(Object.entries(set).map(([name, node]) => [name, markup(node)])));

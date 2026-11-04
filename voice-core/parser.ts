/**
 * Ядро голосовых команд для счётчика очков Skull King (русский язык).
 *
 * Чистые функции: без DOM, без привязки к движку речи и к UI-фреймворку.
 * Работает в браузере, React Native, Node; логику легко перенести на Dart/Kotlin,
 * а cases.json можно использовать как общий набор тестов.
 *
 * Принципы отсева шума:
 *  1. Окна ввода: parseName / parseBids / parseResults — у каждого своя грамматика.
 *  2. Строгость: если в фразе есть хоть одно слово вне грамматики, отклоняется вся фраза.
 *  3. Имя без числа не считается командой. Ноль только явный («Аня ноль»);
 *     неупомянутые игроки получают 0 через completeBids().
 *  4. Проверки по смыслу: диапазон ставок, сумма взяток (validateResults),
 *     бонус только при сошедшейся ставке.
 *  5. Парсер возвращает ЧЕРНОВИК. В игру он попадает только после подтверждения в UI.
 *
 * Движок речи отдаёт список вариантов распознавания (Web Speech API: maxAlternatives).
 * Берётся первый вариант, который проходит грамматику.
 */

// ---------- типы ----------

export interface Player {
  name: string;
  /** Прозвища, если имена звучат похоже (Аня / Ваня). */
  aliases?: string[];
}
export type PlayerInput = string | Player;

export type Reason =
  | 'empty'
  | 'unknown_word'
  | 'no_pairs'
  | 'out_of_range'
  | 'conflict'
  | 'ambiguous_name'
  | 'duplicate'
  | 'bad_name';

export interface Ok<T> {
  ok: true;
  draft: T;
  warnings: string[];
  heard: string;
}
export interface Fail {
  ok: false;
  reason: Reason;
  detail?: string;
  heard: string;
}
export type Parsed<T> = Ok<T> | Fail;

export interface BidsDraft {
  /** Только явно названные игроки. */
  bids: Record<string, number>;
}
export interface ResultsDraft {
  tricks: Record<string, number>;
  bonus: Record<string, number>;
  kraken?: boolean;
}
export interface NameDraft {
  name?: string;
  /** Сказано «готово»: имена закончились. */
  done?: boolean;
}

export interface Issue {
  level: 'error' | 'warn';
  code: 'sum_mismatch' | 'bonus_ignored';
  msg: string;
}

// ---------- нормализация и числа ----------

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tok = (s: string): string[] => {
  const n = norm(s);
  return n ? n.split(' ') : [];
};

const mk = (spec: string): Map<string, number> =>
  new Map(
    spec.split(' ').map((p) => {
      const [w, v] = p.split(':');
      return [w as string, Number(v)] as [string, number];
    }),
  );

const UNITS = mk(
  'ноль:0 нуль:0 один:1 одна:1 одну:1 одно:1 два:2 две:2 три:3 четыре:4 пять:5 шесть:6 семь:7 восемь:8 девять:9',
);
const TEENS = mk(
  'десять:10 одиннадцать:11 двенадцать:12 тринадцать:13 четырнадцать:14 пятнадцать:15 шестнадцать:16 семнадцать:17 восемнадцать:18 девятнадцать:19',
);
const TENS = mk('двадцать:20 тридцать:30 сорок:40 пятьдесят:50 шестьдесят:60 семьдесят:70 восемьдесят:80 девяносто:90');

function readNumber(t: string[], i: number): { value: number; len: number } | null {
  const w = t[i];
  if (w === undefined) return null;
  if (/^\d+$/.test(w)) return { value: Number(w), len: 1 };
  const ten = TENS.get(w);
  if (ten !== undefined) {
    const u = UNITS.get(t[i + 1] ?? '');
    if (u !== undefined && u > 0) return { value: ten + u, len: 2 };
    return { value: ten, len: 1 };
  }
  const teen = TEENS.get(w);
  if (teen !== undefined) return { value: teen, len: 1 };
  const unit = UNITS.get(w);
  if (unit !== undefined) return { value: unit, len: 1 };
  return null;
}

// ---------- имена ----------

const VOWELS = 'аеиоуыэюя';

/** Падежные формы одного слова: Аня → ани, ане, аню…; Иван → ивана, ивану…; Игорь → игоря… */
function declined(base: string): string[] {
  const n = norm(base);
  if (!n) return [];
  if (n.includes(' ')) return [n];
  const out = new Set<string>([n]);
  const last = n.slice(-1);
  const stem = n.slice(0, -1);
  if (last === 'а' || last === 'я') {
    for (const e of ['а', 'я', 'ы', 'и', 'е', 'у', 'ю', 'ой', 'ей', 'ою', 'ею']) out.add(stem + e);
  } else if (last === 'й' || last === 'ь') {
    for (const e of ['й', 'ь', 'я', 'ю', 'ем', 'е', 'ей']) out.add(stem + e);
  } else if (!VOWELS.includes(last)) {
    for (const e of ['а', 'у', 'ом', 'е', 'ы']) out.add(n + e);
  }
  return [...out];
}

interface Index {
  forms: Map<string, Set<string>>;
}

const toPlayers = (ps: PlayerInput[]): Player[] => ps.map((p) => (typeof p === 'string' ? { name: p } : p));

function buildIndex(players: Player[]): Index {
  const forms = new Map<string, Set<string>>();
  for (const p of players) {
    for (const base of [p.name, ...(p.aliases ?? [])]) {
      for (const f of declined(base)) {
        let owners = forms.get(f);
        if (!owners) {
          owners = new Set<string>();
          forms.set(f, owners);
        }
        owners.add(p.name);
      }
    }
  }
  return { forms };
}

/** Расстояние Левенштейна не больше 1. */
function within1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Каноничные имена игроков, подходящие под слово. Нечётко только для слов от 5 букв. */
function matchName(w: string, idx: Index): string[] {
  const hit = idx.forms.get(w);
  if (hit) return [...hit];
  if (w.length < 5) return [];
  const out = new Set<string>();
  for (const [form, owners] of idx.forms) {
    if (form.length >= 5 && within1(w, form)) owners.forEach((o) => out.add(o));
  }
  return [...out];
}

// ---------- общие помощники ----------

const fail = (reason: Reason, heard: string, detail?: string): Fail =>
  detail === undefined ? { ok: false, reason, heard } : { ok: false, reason, heard, detail };

/** Первый вариант распознавания, который проходит грамматику; иначе ошибка по лучшему варианту. */
function best<T>(alts: string[], one: (text: string) => Parsed<T>): Parsed<T> {
  const list = alts.filter((a) => a && a.trim());
  if (!list.length) return fail('empty', '');
  let firstFail: Parsed<T> | null = null;
  for (const a of list) {
    const r = one(a);
    if (r.ok) return r;
    if (!firstFail) firstFail = r;
  }
  return firstFail as Parsed<T>;
}

// ---------- окно «имена» ----------

const NAME_STOP = new Set(
  'ну так вот это эм ээ короче ладно давай да нет ага угу привет пока кракен русалка пират лут бонус ставка ставки раунд игра отмена принять'.split(
    ' ',
  ),
);
const NAME_DONE = new Set(['готово', 'хватит', 'достаточно', 'конец']);

const cap = (s: string): string =>
  s
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('-');

/**
 * Одно имя за фразу: по умолчанию одно слово (дефис допустим), не число, не команда, не дубль.
 * Для имён из нескольких слов передайте opts.maxWords.
 */
export function parseName(
  alts: string[],
  players: PlayerInput[],
  opts: { maxWords?: number } = {},
): Parsed<NameDraft> {
  const maxWords = opts.maxWords ?? 1;
  const P = toPlayers(players);
  const idx = buildIndex(P);
  return best<NameDraft>(alts, (text) => {
    const t = tok(text);
    if (!t.length) return fail('empty', text);
    if (t.length === 1 && NAME_DONE.has(t[0] as string)) {
      return { ok: true, draft: { done: true }, warnings: [], heard: text };
    }
    const raw = text.trim().split(/[\s,.;:!?]+/).filter(Boolean);
    if (raw.length > maxWords) return fail('bad_name', text, 'слишком длинная фраза');
    for (const w of t) {
      if (w.length < 2 || /\d/.test(w) || NAME_STOP.has(w) || NAME_DONE.has(w) || readNumber([w], 0)) {
        return fail('bad_name', text, w);
      }
    }
    const name = raw.map(cap).join(' ');
    const me = norm(name);
    if (P.some((p) => norm(p.name) === me) || (t.length === 1 && matchName(t[0] as string, idx).length)) {
      return fail('duplicate', text, name);
    }
    const warnings: string[] = [];
    for (const p of P) {
      const other = norm(p.name);
      if (within1(me, other)) warnings.push(`«${name}» похоже на «${p.name}»: лучше дать одному прозвище`);
    }
    return { ok: true, draft: { name }, warnings, heard: text };
  });
}

// ---------- окно «ставки» ----------

const FILL_BIDS = new Set(['и', 'у', 'ставка', 'ставки', 'ставит', 'поставил', 'поставила']);

function parseBidsOne(text: string, idx: Index, ctx: { cards: number }): Parsed<BidsDraft> {
  const t = tok(text);
  if (!t.length) return fail('empty', text);
  const bids = new Map<string, number>();
  const warnings: string[] = [];
  let i = 0;
  while (i < t.length) {
    const w = t[i] as string;
    if (FILL_BIDS.has(w)) {
      i++;
      continue;
    }
    const names = matchName(w, idx);
    if (names.length > 1) return fail('ambiguous_name', text, w);
    if (names.length === 0) return fail('unknown_word', text, w);
    const name = names[0] as string;
    let j = i + 1;
    while (j < t.length && FILL_BIDS.has(t[j] as string)) j++;
    const num = readNumber(t, j);
    if (!num) {
      warnings.push(`${name}: нет числа, пропущено`);
      i++;
      continue;
    }
    if (num.value > ctx.cards) return fail('out_of_range', text, `${name} ${num.value}`);
    const prev = bids.get(name);
    if (prev !== undefined && prev !== num.value) return fail('conflict', text, name);
    bids.set(name, num.value);
    i = j + num.len;
  }
  if (!bids.size) return fail('no_pairs', text);
  return { ok: true, draft: { bids: Object.fromEntries(bids) }, warnings, heard: text };
}

/** «Аня два, Дима один»: неупомянутые игроки получат 0 в completeBids(). */
export function parseBids(alts: string[], players: PlayerInput[], ctx: { cards: number }): Parsed<BidsDraft> {
  const idx = buildIndex(toPlayers(players));
  return best(alts, (text) => parseBidsOne(text, idx, ctx));
}

// ---------- окно «итоги раунда» ----------

const FILL_RES = new Set(['и', 'у', 'взял', 'взяла', 'взяли', 'взято', 'взятки']);
const isBonusKeyword = (w: string): boolean => w === 'бонус' || w === 'бонусы' || w === 'бонусов';

/** Бонусные события. Слово «четырнадцать» само по себе считается только после слова «бонус». */
function readEvent(t: string[], i: number, afterKeyword: boolean): { pts: number; len: number } | null {
  const is = (k: number, re: RegExp): boolean => re.test(t[i + k] ?? '');
  if (is(0, /^черн/) && is(1, /^пират/) && is(2, /^побил/) && is(3, /^пират/)) return { pts: 30, len: 4 };
  if (is(0, /^русалк/) && is(1, /^побил/) && is(2, /^черн/) && is(3, /^пират/)) return { pts: 40, len: 4 };
  if (is(0, /^пират/) && is(1, /^побил/) && is(2, /^русалк/)) return { pts: 20, len: 3 };
  if (is(0, /^(черн|козырн)/) && is(1, /^четырнадцат/)) return { pts: 20, len: 2 };
  if (is(0, /^четырнадцат/)) return afterKeyword ? { pts: 10, len: 1 } : null;
  if (t[i] === 'лут') return { pts: 20, len: 1 };
  return null;
}

function parseResultsOne(text: string, idx: Index, ctx: { cards: number }): Parsed<ResultsDraft> {
  const t = tok(text);
  if (!t.length) return fail('empty', text);
  const tricks = new Map<string, number>();
  const bonus = new Map<string, number>();
  const seen = new Set<string>();
  let kraken: boolean | undefined;
  let cur: string | null = null;
  let i = 0;
  while (i < t.length) {
    const w = t[i] as string;
    if (FILL_RES.has(w)) {
      i++;
      continue;
    }
    if ((w === 'без' || w === 'нет') && /^кракен/.test(t[i + 1] ?? '')) {
      kraken = false;
      cur = null;
      i += 2;
      continue;
    }
    if (/^кракен/.test(w)) {
      kraken = true;
      cur = null;
      i++;
      continue;
    }
    const names = matchName(w, idx);
    if (names.length > 1) return fail('ambiguous_name', text, w);
    if (names.length === 1) {
      cur = names[0] as string;
      seen.add(cur);
      i++;
      continue;
    }
    if (isBonusKeyword(w)) {
      if (!cur) return fail('unknown_word', text, w);
      i++;
      let got = 0;
      for (;;) {
        const ev = readEvent(t, i, true);
        if (ev) {
          bonus.set(cur, (bonus.get(cur) ?? 0) + ev.pts);
          i += ev.len;
          got++;
          continue;
        }
        const n = readNumber(t, i);
        if (n && n.len === 1 && n.value >= 10 && n.value % 10 === 0) {
          bonus.set(cur, (bonus.get(cur) ?? 0) + n.value);
          i++;
          got++;
          continue;
        }
        break;
      }
      if (!got) return fail('unknown_word', text, t[i] ?? w);
      continue;
    }
    if (cur) {
      const ev = readEvent(t, i, false);
      if (ev) {
        bonus.set(cur, (bonus.get(cur) ?? 0) + ev.pts);
        i += ev.len;
        continue;
      }
      const n = readNumber(t, i);
      if (n) {
        if (n.value > ctx.cards) return fail('out_of_range', text, `${cur} ${n.value}`);
        const prev = tricks.get(cur);
        if (prev !== undefined && prev !== n.value) return fail('conflict', text, cur);
        tricks.set(cur, n.value);
        i += n.len;
        continue;
      }
    }
    return fail('unknown_word', text, w);
  }
  if (!tricks.size && !bonus.size && kraken === undefined) return fail('no_pairs', text);
  const warnings: string[] = [];
  for (const n of seen) {
    if (!tricks.has(n) && !bonus.has(n)) warnings.push(`${n}: нет данных, пропущено`);
  }
  const draft: ResultsDraft = { tricks: Object.fromEntries(tricks), bonus: Object.fromEntries(bonus) };
  if (kraken !== undefined) draft.kraken = kraken;
  return { ok: true, draft, warnings, heard: text };
}

/**
 * «Кракен, Аня два, Дима один», «Оля бонус сорок», «Иван русалка побила чёрного пирата».
 * Бонусы: 14-я карта +10 (после слова «бонус»), чёрная 14-я +20, пират побил русалку +20,
 * чёрный пират побил пирата +30, русалка побила чёрного пирата +40, лут +20, «бонус <10,20,…>».
 */
export function parseResults(alts: string[], players: PlayerInput[], ctx: { cards: number }): Parsed<ResultsDraft> {
  const idx = buildIndex(toPlayers(players));
  return best(alts, (text) => parseResultsOne(text, idx, ctx));
}

// ---------- черновики и проверки ----------

export function mergeBids(prev: BidsDraft, next: BidsDraft): BidsDraft {
  return { bids: { ...prev.bids, ...next.bids } };
}

/** Полные ставки: неупомянутые игроки получают 0. */
export function completeBids(d: BidsDraft, players: PlayerInput[]): Record<string, number> {
  return Object.fromEntries(toPlayers(players).map((p) => [p.name, d.bids[p.name] ?? 0]));
}

export function mergeResults(prev: ResultsDraft, next: ResultsDraft): ResultsDraft {
  const out: ResultsDraft = {
    tricks: { ...prev.tricks, ...next.tricks },
    bonus: { ...prev.bonus, ...next.bonus },
  };
  const kraken = next.kraken ?? prev.kraken;
  if (kraken !== undefined) out.kraken = kraken;
  return out;
}

/**
 * Проверки итогов. Ошибка уровня 'error' блокирует «Принять».
 * Сумма взяток должна равняться числу карт (минус 1, если был Кракен: эта взятка ни у кого).
 */
export function validateResults(input: {
  players: PlayerInput[];
  cards: number;
  draft: ResultsDraft;
  /** Кракен, уже отмеченный в раунде, если в черновике его нет. */
  kraken?: boolean;
  /** Ставки раунда: нужны, чтобы предупредить о бонусе при несошедшейся ставке. */
  bids?: Record<string, number>;
}): Issue[] {
  const names = toPlayers(input.players).map((p) => p.name);
  const kraken = input.draft.kraken ?? input.kraken ?? false;
  const tricks: Record<string, number> = Object.fromEntries(names.map((n) => [n, input.draft.tricks[n] ?? 0]));
  const sum = Object.values(tricks).reduce((a, b) => a + b, 0);
  const expected = input.cards - (kraken ? 1 : 0);
  const issues: Issue[] = [];
  if (sum !== expected) {
    issues.push({ level: 'error', code: 'sum_mismatch', msg: `Сумма взяток ${sum}, нужно ${expected}` });
  }
  const bids = input.bids;
  if (bids) {
    for (const [n, pts] of Object.entries(input.draft.bonus)) {
      if (pts > 0 && bids[n] !== (tricks[n] ?? 0)) {
        issues.push({ level: 'warn', code: 'bonus_ignored', msg: `${n}: ставка не сошлась, бонус ${pts} не засчитается` });
      }
    }
  }
  return issues;
}

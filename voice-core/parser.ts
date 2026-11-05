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
  /** Слова, которые нестрогий разбор пропустил (ставки и итоги). */
  unknown?: string[];
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

// ---------- окна «ставки» и «итоги»: нестрогий разбор ----------
//
// Диктовка за столом нечёткая: «Так, Валера взял один, бонусы есть, альянс с Денисом, Денис ноль, всё».
// Слова-связки пропускаются. Незнакомое слово не ломает фразу: оно попадает в предупреждение
// «не понял» и сбрасывает текущего игрока, так что число относится к имени, только если между ними
// одни связки («Дима, у тебя два туза» по-прежнему ничего не даёт). Поправка «нет / вернее» меняет
// уже названное число. Черновик всё равно подтверждает человек.

const COMMON_FILL = new Set(
  'так ну вот это эм ээ эээ короче ладно давай да ага угу есть значит получается итак теперь дальше потом там тут еще тоже все а и у с со нас кем он она они я мы меня него нее ее его ему ей сам сама'.split(
    ' ',
  ),
);
const FILL_BIDS = new Set(['ставка', 'ставки', 'ставит', 'ставлю', 'поставил', 'поставила', 'заказал', 'заказала']);
const FILL_RES = new Set(
  'взял взяла взяли взято взятки взятка взятку взятках получил получила сделал сделала набрал набрала был была было'.split(' '),
);
const CORRECTION = new Set(['нет', 'вернее', 'точнее', 'ой', 'поправка']);

const isBonusKeyword = (w: string): boolean => /^бонус/.test(w);
const isFourteen = (w: string): boolean => /^четырнадцат/.test(w) || w === '14';
const HIT = /^(побил|побила|бьет|убил|убила|забрал|забрала|съел|съела|взял|взяла)$/;
const COUNT = mk('1:1 2:2 3:3 4:4 5:5 один:1 одного:1 одну:1 два:2 две:2 двух:2 двоих:2 три:3 трех:3 троих:3 четыре:4 четырех:4 пять:5 пяти:5');

/**
 * Бонусное событие с позиции i. Сокращения тоже: «пират пирата» = чёрный пират побил пирата (+30),
 * «пират русалку» (+20), «русалка чёрного пирата» (+40), «пират двух пиратов» (+60).
 * «Четырнадцать» без «чёрная» считается (+10) только в бонусной части (после «бонус», «плюс» или события).
 */
function readEvent(t: string[], i: number, inBonus: boolean): { pts: number; len: number } | null {
  const at = (k: number): string => t[i + k] ?? '';
  let k = 0;
  const black = /^(черн|козырн)/.test(at(0));
  if (black) k++;
  const subj = at(k);
  if (isFourteen(subj)) return black ? { pts: 20, len: k + 1 } : inBonus ? { pts: 10, len: 1 } : null;
  if (black && !/^пират/.test(subj)) return null;
  const pirate = /^пират/.test(subj) || /^(корол|скалкинг|скулкинг)/.test(subj);
  const mermaid = /^русалк/.test(subj);
  if (!pirate && !mermaid) return null;
  k++;
  if (HIT.test(at(k))) k++;
  if (mermaid) {
    if (/^черн/.test(at(k))) k++;
    return /^(пират|корол|скалкинг|скулкинг)/.test(at(k)) ? { pts: 40, len: k + 1 } : null;
  }
  const n = COUNT.get(at(k));
  if (n !== undefined) k++;
  const times = n ?? 1;
  if (/^русалк/.test(at(k))) return black ? null : { pts: 20 * times, len: k + 1 }; // чёрного пирата бьёт русалка, а не наоборот
  if (/^пират/.test(at(k))) return { pts: 30 * times, len: k + 1 };
  return null;
}

/** Первый вариант распознавания, понятый целиком; если такого нет, первый понятый с пропусками. */
function bestOf<T>(alts: string[], one: (text: string) => Parsed<T>): Parsed<T> {
  const list = alts.filter((a) => a && a.trim());
  if (!list.length) return fail('empty', '');
  let partial: Parsed<T> | null = null;
  let firstFail: Parsed<T> | null = null;
  for (const a of list) {
    const r = one(a);
    if (r.ok && !r.unknown?.length) return r;
    if (r.ok) partial ??= r;
    else firstFail ??= r;
  }
  return (partial ?? firstFail) as Parsed<T>;
}

const unknownNote = (words: string[]): string => `Не понял и пропустил: «${words.join(' ')}»`;
const nothing = (text: string, unknown: string[]): Fail =>
  unknown.length ? fail('unknown_word', text, unknown[0]) : fail('no_pairs', text);

function parseBidsOne(text: string, idx: Index, ctx: { cards: number }): Parsed<BidsDraft> {
  const t = tok(text);
  if (!t.length) return fail('empty', text);
  const bids = new Map<string, number>();
  const named: string[] = [];
  const unknown: string[] = [];
  let cur: string | null = null;
  let fix = false;
  let fresh = false; // имя только что названо: число заменяет сказанное раньше («Аня один … Аня два»)
  let i = 0;
  while (i < t.length) {
    const w = t[i] as string;
    if (COMMON_FILL.has(w) || FILL_BIDS.has(w)) {
      i++;
      continue;
    }
    if (CORRECTION.has(w)) {
      fix = true;
      i++;
      continue;
    }
    const names = matchName(w, idx);
    if (names.length > 1) return fail('ambiguous_name', text, w);
    if (names.length === 1) {
      cur = names[0] as string;
      named.push(cur);
      fix = false;
      fresh = true;
      i++;
      continue;
    }
    const num = readNumber(t, i);
    if (num && cur) {
      if (num.value > ctx.cards) return fail('out_of_range', text, `${cur} ${num.value}`);
      const prev = bids.get(cur);
      if (prev !== undefined && prev !== num.value && !fix && !fresh) return fail('conflict', text, cur);
      bids.set(cur, num.value);
      fix = false;
      fresh = false;
      i += num.len;
      continue;
    }
    unknown.push(w);
    cur = null;
    i++;
  }
  if (!bids.size) return nothing(text, unknown);
  const warnings = named.filter((n) => !bids.has(n)).map((n) => `${n}: нет числа, пропущено`);
  if (unknown.length) warnings.push(unknownNote(unknown));
  return { ok: true, draft: { bids: Object.fromEntries(bids) }, warnings, heard: text, unknown };
}

/** «Аня два, Дима один», «так, у Ани два, Дима ноль, всё»: неупомянутые игроки получат 0 в completeBids(). */
export function parseBids(alts: string[], players: PlayerInput[], ctx: { cards: number }): Parsed<BidsDraft> {
  const idx = buildIndex(toPlayers(players));
  return bestOf(alts, (text) => parseBidsOne(text, idx, ctx));
}

function parseResultsOne(text: string, idx: Index, ctx: { cards: number }): Parsed<ResultsDraft> {
  const t = tok(text);
  if (!t.length) return fail('empty', text);
  const tricks = new Map<string, number>();
  const bonus = new Map<string, number>();
  const seen = new Set<string>();
  const unknown: string[] = [];
  const addBonus = (who: string, pts: number): void => {
    bonus.set(who, (bonus.get(who) ?? 0) + pts);
  };
  // Повторное упоминание игрока заменяет сказанное о нём раньше: первый бонус после имени ставится, а не
  // прибавляется («Валера плюс двадцать … Валера плюс двадцать» = 20). Альянсы считаются в конце отдельно.
  let mentionBonus = false;
  const bonusHere = (pts: number): void => {
    if (!cur) return;
    if (mentionBonus) addBonus(cur, pts);
    else bonus.set(cur, pts);
    mentionBonus = true;
  };
  // Лут и альянс: «альянс с Денисом» — пара, +20 обоим один раз; без партнёра +20 тому, кто сказал.
  const allies: { who: string; partner: string | null }[] = [];
  let ally: { who: string; partner: string | null } | null = null; // последнее упоминание у текущего игрока
  let partner: string | null = null; // «с Денисом», сказанное до слова «альянс»
  let kraken: boolean | undefined;
  let cur: string | null = null;
  let inBonus = false; // после «бонус», «плюс» или события число кратное 10 — это бонус
  let fix = false;
  let fresh = false; // имя только что названо: взятки заменяют сказанные раньше
  const drop = (): void => {
    cur = null;
    ally = null;
    partner = null;
  };
  let i = 0;
  while (i < t.length) {
    const w = t[i] as string;
    if ((w === 'без' || w === 'нет') && /^кракен/.test(t[i + 1] ?? '')) {
      kraken = false;
      drop();
      i += 2;
      continue;
    }
    if (/^кракен/.test(w)) {
      kraken = true;
      drop();
      i++;
      continue;
    }
    if (COMMON_FILL.has(w) || FILL_RES.has(w)) {
      i++;
      continue;
    }
    if (CORRECTION.has(w)) {
      fix = true;
      i++;
      continue;
    }
    const names = matchName(w, idx);
    if (names.length > 1) return fail('ambiguous_name', text, w);
    if (names.length === 1) {
      // «альянс с Денисом»: партнёр, а не следующий игрок
      if (cur && (t[i - 1] === 'с' || t[i - 1] === 'со')) {
        if (ally && !ally.partner) ally.partner = names[0] as string;
        else partner = names[0] as string;
        i++;
        continue;
      }
      cur = names[0] as string;
      ally = null;
      partner = null;
      seen.add(cur);
      inBonus = false;
      fix = false;
      fresh = true;
      mentionBonus = false;
      i++;
      continue;
    }
    if (cur && (isBonusKeyword(w) || w === 'плюс')) {
      inBonus = true;
      i++;
      continue;
    }
    if (cur && /^(лут|альянс)/.test(w)) {
      ally = { who: cur, partner };
      allies.push(ally);
      partner = null;
      inBonus = true;
      i++;
      continue;
    }
    if (cur) {
      const ev = readEvent(t, i, inBonus);
      if (ev) {
        bonusHere(ev.pts);
        inBonus = true;
        fresh = false;
        i += ev.len;
        continue;
      }
      const n = readNumber(t, i);
      if (n) {
        const v = n.value;
        const prev = tricks.get(cur);
        const bonusLike = v >= 10 && v % 10 === 0;
        if (inBonus && bonusLike) bonusHere(v);
        else if (prev === undefined || prev === v || fix || (fresh && v <= ctx.cards)) {
          if (v > ctx.cards) return fail('out_of_range', text, `${cur} ${v}`);
          tricks.set(cur, v);
          inBonus = false;
          fix = false;
        } else if (bonusLike) {
          bonusHere(v); // «Валера два двадцать»: взятки уже названы
          inBonus = true;
        } else return fail('conflict', text, cur);
        fresh = false;
        i += n.len;
        continue;
      }
    }
    unknown.push(w);
    drop();
    inBonus = false;
    i++;
  }
  const paired = new Set<string>();
  const inPair = new Set<string>();
  for (const a of allies) {
    if (!a.partner || a.partner === a.who) continue;
    const key = [a.who, a.partner].sort().join('|');
    if (!paired.has(key)) {
      paired.add(key);
      addBonus(a.who, 20);
      addBonus(a.partner, 20);
    }
    inPair.add(a.who).add(a.partner);
  }
  for (const a of allies) {
    if ((!a.partner || a.partner === a.who) && !inPair.has(a.who)) addBonus(a.who, 20); // «лут лут» = +40
  }
  // Один «кракен» среди непонятных слов — болтовня («кракен выйдет, зуб даю»), а не итог.
  if (!tricks.size && !bonus.size && (kraken === undefined || unknown.length)) return nothing(text, unknown);
  const warnings: string[] = [];
  for (const n of seen) {
    if (!tricks.has(n) && !bonus.has(n)) warnings.push(`${n}: нет данных, пропущено`);
  }
  if (unknown.length) warnings.push(unknownNote(unknown));
  const draft: ResultsDraft = { tricks: Object.fromEntries(tricks), bonus: Object.fromEntries(bonus) };
  if (kraken !== undefined) draft.kraken = kraken;
  return { ok: true, draft, warnings, heard: text, unknown };
}

/**
 * «Кракен, Аня два, Дима один», «Оля бонус сорок», «Валера два, бонусы пират пирата плюс двадцать».
 * Бонусы: 14-я карта +10 (в бонусной части), чёрная 14-я +20, пират побил русалку +20,
 * чёрный пират побил пирата +30 (×число пиратов), русалка побила чёрного пирата +40, лут или альянс +20,
 * число кратное 10 после «бонус», «плюс» или события. «Альянс с Денисом» даёт +20 обоим (пара считается
 * один раз, сколько её ни называй). Засчитывать ли альянс по ставкам, решают игроки сами.
 */
export function parseResults(alts: string[], players: PlayerInput[], ctx: { cards: number }): Parsed<ResultsDraft> {
  const idx = buildIndex(toPlayers(players));
  return bestOf(alts, (text) => parseResultsOne(text, idx, ctx));
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

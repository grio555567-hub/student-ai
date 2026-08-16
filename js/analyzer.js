/* ===== StudyMind AI — on-device text analyzer =====
   No external AI key needed. Extracts definitions, formulas,
   tasks, topics, key terms from lecture text / materials,
   and generates summaries, flashcards and quiz questions.

   v8: fixes for textbook/PDF imports:
   - rejoins words broken by PDF line-break hyphens («Сло- жение» -> «Сложение»)
   - word-safe truncation (no mid-word cuts in cards/quiz/topics)
   - strict garbage filters: hyphen fragments, clerical phrases
     («Функция определяется») and title-page boilerplate are rejected
   - fill-blank cards only for single words, matched on word boundaries
     (term «матрица» no longer tears «матрицами» apart)
   - task-based junk flashcards/questions removed; quiz gets only real
     definition/formula questions, empty result instead of nonsense fallback
*/
(function (global) {
  'use strict';

  /* ---------- raw string helpers ---------- */
  /* Склеивает слова, разорванные переносом при извлечении из PDF:
     «опреде-\nление», «Сло- жение», «Сло -жение», «мето -дика»
     -> «определение», «Сложение», «Сложение», «методика» */
  function joinBrokenWords(str) {
    return String(str || '')
      .replace(/([а-яёa-z])-\s+(?=[а-яёa-z])/g, '$1')   // «Сло- жение»
      .replace(/([а-яёa-z])\s+-(?=[а-яёa-z])/g, '$1')   // «Сло -жение», «мето -дика»
      .replace(/([а-яёa-z])\s+-\s+(?=[а-яёa-zА-ЯЁA-Z])/g, '$1 '); // «слово - Начало фразы»
  }

  function norm(str) {
    return joinBrokenWords(String(str || '')
      .replace(/[\u00AD\u2010\u2011]/g, '-')      // мягкие/типографские дефисы
      .replace(/[\|\u00A0\u2588\u25A0\u25A1\uFEFF]/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lower(str) { return norm(str).toLowerCase(); }

  function uniqueBy(arr, keyFn) {
    const seen = new Set();
    return arr.filter(item => {
      const k = keyFn(item).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* Обрезка без разрыва слова: режем по последнему пробелу до лимита */
  function truncate(str, n) {
    const s = norm(str);
    if (s.length <= n) return s;
    const cut = s.slice(0, n + 1);
    const space = cut.lastIndexOf(' ');
    if (space > Math.floor(n * 0.5)) return cut.slice(0, space) + '…';
    return cut.slice(0, n) + '…';
  }

  /* Признак слова, разорванного переносом PDF, внутри уже нормализованной строки */
  function hasBrokenHyphen(s) {
    return /[а-яёa-z]-\s+|[а-яёa-z]\s+-/.test(s);
  }

  /* ---------- sentencify ---------- */
  function splitSentences(text) {
    return norm(text)
      .replace(/([.!?…])\s+(?=[А-ЯЁA-Z0-9«"(])/g, '$1\n')
      .split('\n')
      .map(s => norm(s))
      .filter(s => s.length > 12);
  }

  /* ---------- shared stop/short word sets & garbage filters ---------- */
  const SHORT_OK = new Set(['и', 'в', 'с', 'на', 'по', 'о', 'об', 'от', 'из', 'а', 'но', 'до', 'при', 'за', 'у', 'или', 'к', 'для', 'не', 'ни', 'со', 'во', 'ко', 'их', 'её', 'ее']);
  const STOP_WORDS = new Set(['и', 'в', 'на', 'с', 'по', 'о', 'об', 'от', 'из', 'а', 'но', 'до', 'при', 'за', 'у', 'или', 'к', 'для', 'не', 'ни', 'это', 'как', 'что', 'между', 'через', 'более', 'менее', 'при', 'со', 'во', 'ко']);
  const LEVEL_WORDS = new Set(['новый', 'начало', 'базово', 'уверенно', 'отлично']);
  const GREETING_RE = /успехов|спасибо|предлагается|серия заданий|добро пожаловать|здравствуй|здравствуйте|приветств|желаю|дорогие друзья|удачи|благодарю|изучени/i;
  /* ВАЖНО: в JS «\b» не работает с кириллицей (\w = [A-Za-z0-9_]).
     Для русских слов используем (?=\s|$) или [а-яё]* вместо \w*. */
  const TITLE_RE = /^(допущено|рецензент|составител|министерств[а-яё]*|образован[а-яё]*|российск[а-яё]*|издательств[а-яё]*|год издани|автор|вам|вас|удк|ббк|isbn)(?=\s|$)/i;

  const FRAGMENT_RE = /^(й|ам|вым|ым|ом|ем|их|ого|его|ими|ыми|ая|ое|ые|ий)(?=\s|$)/i;
  const EMPTY_TERM_RE = /^(это|так|вот|значит|самое|главное|важно|основное|необходимо|нужно)(?=\s|$)/i;

  function isInitial(w) {
    return /^[А-ЯЁA-Z]\.$/.test(w) || /^[А-ЯЁA-Z]\.[А-ЯЁA-Z]?\.?$/.test(w);
  }

  function isProperWord(w) {
    return /^[А-ЯЁA-Z][а-яёa-z-]{2,}$/.test(w);
  }

  function isStopWord(w) {
    const l = w.toLowerCase();
    return STOP_WORDS.has(l) || LEVEL_WORDS.has(l) || isInitial(w);
  }

  /* Убирает «5.», «5 —», «: » и прилипшие уровни («Базово», «Новый»...) */
  function cleanTopicName(name) {
    let s = norm(name)
      .replace(/^[\s№:—-]+/, '')
      .replace(/^\d+[\s:.)-]*\s*/, '')
      .replace(/^[\s№:—-]+/, '')
      .replace(/\s*(Новый|Начало|Базово|Уверенно|Отлично)\s*$/i, '')
      .replace(/[.:!?;]+$/, '');
    return s.trim();
  }

  function isGarbageTerm(t) {
    const s = norm(t);
    if (s.length < 4 || s.length > 70) return true;
    if (/[.,;«»()\[\]{}—–|]/.test(s)) return true;
    if (s.indexOf('-') > -1) return true;              // дефис/перенос: «Сло- жение»
    if (hasBrokenHyphen(s)) return true;
    if (LEVEL_WORDS.has(s.toLowerCase())) return true;
    if (GREETING_RE.test(s)) return true;
    if (TITLE_RE.test(s)) return true;
    if (EMPTY_TERM_RE.test(s)) return true;
    if (/(^|\s)[А-ЯЁA-Z]\.(\s|$)/.test(s)) return true;   // инициалы «О. С.»
    if (/\s[А-ЯЁA-Z]\.?\s*$/.test(s)) return true;         // «Фамилия И.»
    if (/^[А-ЯЁA-Z]\.\s+[А-ЯЁA-Z]/.test(s)) return true;   // «И. Г. ...»
    if (FRAGMENT_RE.test(s)) return true;
    if (!/[А-ЯЁA-Z]/.test(s)) return true;
    const words = s.split(/\s+/);
    if (words.some(w => w.length <= 2 && !SHORT_OK.has(w.toLowerCase()))) return true;
    if (words.length > 5) return true;
    return false;
  }

  function isGarbageDefinition(d) {
    const s = norm(d);
    if (!s || s.length < 8) return true;
    if (s.indexOf('|') > -1) return true;
    if (hasBrokenHyphen(s)) return true;
    if (GREETING_RE.test(s)) return true;
    if (FRAGMENT_RE.test(s)) return true;
    // обрывок вместо определения: «на множестве действительных чисел»,
    // «при котором выполняется условие», «который характеризует...»
    if (/^(на|в|с|по|о|об|от|из|при|за|у|до|для|к|через|между|без|как|чтобы|который|которая|которые|которое|где|когда|если)(?=\s|$)/i.test(s)) return true;
    return false;
  }

  /* ---------- keyword dictionaries ---------- */
  const FORMULA_HINTS = ['формул', 'уравнени', 'равенств', '∫', '∑', '√', 'Δ', 'λ', 'dx', 'dy', '=', 'O(', '∂', 'π', '⁻', 'ⁿ', '²', '³'];
  const DEF_HINTS = ['— это', 'это', 'называется', 'называют', 'определяется', 'представляет собой', 'означает', 'является', 'характеризуется', 'состоит из'];
  const TASK_HINTS = ['задани', 'упражнени', 'решить', 'вычислить', 'найти', 'докажите', 'постройте', 'выведите', 'практик', 'пример'];
  const TOPIC_HINTS = ['тема', 'раздел', 'глава', 'лекция', 'параграф'];
  const IMPORTANT_HINTS = ['важно', 'ключевой', 'ключевые', 'обратите внимание', 'запомните', 'главное', 'суть'];

  /* Служебные биграммы («Задание вычислить», «Тема называется», ...),
     которые не являются темами, а лишь канцелярские обороты. */
  const NO_TOPIC_WORDS = new Set([
    'задание', 'задания', 'заданий', 'упражнение', 'упражнения', 'упражнений', 'пример', 'примеры',
    'решить', 'вычислить', 'найти', 'найдите', 'вычислите', 'докажите', 'постройте', 'выведите', 'определите', 'решите',
    'министерством', 'министерство', 'образования', 'образование', 'российской', 'российской',
    'допущено', 'рецензент', 'автор', 'авторы', 'редактор', 'перевод', 'издание', 'издательство',
    'тема', 'темы', 'раздел', 'глава', 'параграф', 'лекция', 'лекции', 'называется', 'называют',
    'является', 'представляет', 'означает', 'состоит', 'используется', 'применяется', 'важно',
    'ключевой', 'ключевые', 'основные', 'вопросы', 'выводы', 'цель', 'задачи', 'содержание',
    'учебник', 'учебника', 'пособие', 'пособия', 'успехов', 'спасибо', 'желаю', 'благодарю',
    'рассмотрим', 'пусть', 'дано', 'даны', 'найдем', 'найдём', 'решим', 'докажем', 'определим',
    'вычислим', 'заметим', 'отметим', 'обратим', 'введем', 'введём', 'напомним', 'очевидно'
  ]);

  /* Слова, которые не могут быть ВТОРЫМ словом темы («Функция определяется»,
     «Интеграл является», ...). */
  const COMMON_TOPIC_WORD2 = new Set([
    'определяется', 'называется', 'называют', 'является', 'являются', 'представляет', 'означает',
    'состоит', 'используется', 'применяется', 'вычисляется', 'обозначается', 'записывается',
    'рассматривается', 'вводится', 'приводится', 'имеет', 'имеют', 'может', 'можно', 'нужно',
    'должен', 'должны', 'будет', 'быть', 'стать', 'называют', 'получаем', 'получим', 'позволяет',
    'зависит', 'отличается', 'связаны', 'связана', 'связано', 'говорят', 'следует', 'содержит',
    'важно', 'главное', 'основные', 'основное', 'вопросы', 'вопрос', 'выводы', 'вывод', 'цель',
    'задачи', 'например', 'также', 'тогда', 'когда', 'если', 'пусть', 'где', 'который', 'которая',
    'которые', 'которое', 'это', 'есть', 'один', 'одна', 'одно', 'необходимо', 'выражается',
    'справедлива', 'справедливо', 'принимает', 'достигает', 'существует', 'называемые'
  ]);

  /* «Тема 5. Интегралы» -> «Интегралы»; «Глава 2 — Пределы» -> «Пределы» */
  function cutTopicPrefix(s) {
    return s
      .replace(/^(?:тема|раздел|глава|лекция|параграф)\s*\d*[\s:—–.\-]*/i, '')
      .replace(/^\d*[\s:—–.\-]*/, '')
      .trim();
  }

  function isNoTopicWord(w) {
    return NO_TOPIC_WORDS.has(w.toLowerCase());
  }

  function isGarbageTopicInternal(name) {
    if (isGarbageTerm(name)) return true;
    // «Задание вычислить массовую...» — первое слово канцелярское
    const words = name.split(/\s+/);
    if (words.length && isNoTopicWord(words[0])) return true;
    return false;
  }

  function extractTopics(text) {
    const out = [];

    // 1. «Тема 5. Интегралы», «Глава 2. Кислоты и основания», «Раздел: Химия» —
    //    ищем слово-маркер, дальше режем до конца заголовка (до точки / новой фразы)
    const low = lower(text);
    TOPIC_HINTS.forEach(hint => {
      let from = 0;
      while (true) {
        const idx = low.indexOf(hint, from);
        if (idx < 0) break;
        from = idx + hint.length;
        let after = text.slice(idx + hint.length)
          .replace(/^\s*\d+\s*[.:—–\-)]?\s*/, '')
          .trim();
        if (!after) continue;
        const endMatch = after.match(/^(.{2,80}?)(?:[.!?]|$)/);
        const candidate = endMatch ? endMatch[1] : after;

        const cleaned = cleanTopicName(cutTopicPrefix(candidate));
        if (cleaned.length > 2 && cleaned.length < 90 && !isGarbageTopicInternal(cleaned) && !out.includes(cleaned)) {
          out.push(cleaned);
        }
      }
    });

    // 2. fallback: «Заглавное слово + строчное слово» (но не канцелярит:
    //    «Функция определяется», «Рассмотрим функцию» и т.п. отсеиваются)
    const words = norm(text)
      .replace(/[.,!?;:«»"()]+/g, ' ')
      .split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i], b = words[i + 1];
      if (!a || !b) continue;
      if (!isProperWord(a) || isStopWord(a)) continue;
      if (isNoTopicWord(a)) continue;
      if (!(/^[а-яёa-z]/.test(b)) || b.length < 4) continue;
      if (COMMON_TOPIC_WORD2.has(b.toLowerCase())) continue;
      if (isNoTopicWord(b)) continue;
      const pair = cleanTopicName(cutTopicPrefix(a + ' ' + b));
      if (pair.replace(/\s/g, '').length < 7) continue;
      if (isGarbageTopicInternal(pair) || out.includes(pair)) continue;
      out.push(pair);
      if (out.length >= 12) break;
    }
    return uniqueBy(out.slice(0, 12), t => t);
  }


  /* ---------- extraction: definitions ---------- */
  function cleanTerm(raw) {
    return norm(raw)
      .replace(/^[«"']+|[«"']+$/g, '')
      .replace(/^[\s:—–.\-]+|[\s:—–.\-]+$/g, '')
      .trim();
  }

  /* Термин из определения может быть со строчной буквы («коллекция»),
     но не может быть обрывком, инициалом, дефисным переносом или служебным словом. */
  function isGarbageDefTerm(t) {
    const s = norm(t);
    if (s.length < 3 || s.length > 80) return true;
    if (s.indexOf('|') > -1) return true;
    if (/[.,;«»()\[\]{}—–]/.test(s)) return true;
    if (s.indexOf('-') > -1) return true;
    if (hasBrokenHyphen(s)) return true;
    if (GREETING_RE.test(s)) return true;
    if (TITLE_RE.test(s)) return true;
    if (EMPTY_TERM_RE.test(s)) return true;
    if (FRAGMENT_RE.test(s)) return true;
    if (/(^|\s)[А-ЯЁA-Z]\.(\s|$)/.test(s)) return true;
    if (/\s[А-ЯЁA-Z]\.?\s*$/.test(s)) return true;
    const words = s.split(/\s+/);
    if (words.some(w => w.length <= 2 && !SHORT_OK.has(w.toLowerCase()))) return true;
    if (words.length > 4) return true;
    return false;
  }

  function extractDefinitions(text) {
    const out = [];
    splitSentences(text).forEach(s => {
      if (isGarbageDefinition(s)) return;

      // «Определение: Термин — определение» / «Определение. Термин — ...» / «Термин — определение»
      const defMatch = s.match(/^(?:Определение|Определения)\s*[:—–.\-]?\s*(.+?)\s*[—–:]\s*(.+)$/i);
      if (defMatch) {
        const term = cleanTerm(defMatch[1]);
        const def = defMatch[2].replace(/^[:\s-]+/, '').trim();
        if (term && !isGarbageDefTerm(term) && !EMPTY_TERM_RE.test(term)
            && def.length > 5 && !isGarbageDefinition(def)) {
          out.push({ term: truncate(term, 90), definition: truncate(def, 220) });
          return;
        }
      }

      const low = lower(s);
      for (const hint of DEF_HINTS) {
        const idx = low.indexOf(hint);
        if (idx < 0) continue;
        const before = s.slice(0, idx).trim();
        const after = norm(s.slice(idx + hint.length));
        let term = before.split(/[.,:;]/).pop().trim();
        term = term
          .replace(/^(если|пусть|когда|где|который|которая|которое|это|так|вот|например|именно|называется)\s+/i, '')
          .replace(/[—–:\s]+$/, '');
        const def = after.replace(/^[:\s-]+/, '').replace(/[«"']+$/, '');
        if (!term || term.length > 80) continue;
        if (isGarbageDefTerm(term) || EMPTY_TERM_RE.test(term)) continue;

        if (isGarbageDefinition(def)) continue;
        if (def.length < 10) continue;
        // определение должно быть законченной фразой, а не хвостом слова
        if (/^[а-яёa-z]{1,2}\s/.test(def) && !SHORT_OK.has(def.slice(0, def.indexOf(' ')).toLowerCase())) continue;
        out.push({ term: truncate(term, 90), definition: truncate(def, 220) });
        break;
      }
    });
    return uniqueBy(out, d => d.term);
  }

  /* ---------- extraction: formulas ---------- */
  function extractFormulas(text) {
    const out = [];
    splitSentences(text).forEach(s => {
      const has = FORMULA_HINTS.some(h => s.includes(h));
      if (!has) return;
      let formula = null;
      const colonMatch = s.match(/[(Фф]ормул[аы]?[^:]{0,10}:\s*([^.;]+)/);
      if (colonMatch) formula = colonMatch[1];
      else {
        const eqMatch = s.match(/([А-ЯA-Za-z0-9()∫∑√πλ∂\s+\-−=·*^²³ⁿ⁻ˣ⁰¹²{}\[\]\\/.'"]{4,60}?=\s*[^.;]+)/);
        if (eqMatch && eqMatch[1].length > 3) formula = eqMatch[1];
      }
      if (formula) {
        const f = norm(formula).replace(/[.,;:]+$/, '');
        if (f.length < 2 || f.length > 120) return;
        if (GREETING_RE.test(f)) return;
        let desc = s.replace(formula, '').trim();
        desc = desc
          .replace(/^(?:формула|формулы?|уравнение)\s*[:—–]?\s*/i, '')
          .replace(/[—–:;,.\s]+$/, '')
          .trim();
        if (desc.length > 140) desc = truncate(desc, 140);
        out.push({ formula: truncate(f, 120), description: desc });
      }
    });
    return uniqueBy(out, f => f.formula);
  }

  /* ---------- extraction: tasks ---------- */
  function extractTasks(text) {
    const out = [];
    splitSentences(text).forEach(s => {
      const low = lower(s);
      if (TASK_HINTS.some(h => low.includes(h))) {
        const t = norm(s.replace(/^[•\-\d.)\s]+/, ''));
        if (t.length > 5 && !GREETING_RE.test(t) && !FRAGMENT_RE.test(t) && !hasBrokenHyphen(t)) {
          out.push(truncate(t, 170));
        }
      }
    });
    return uniqueBy(out, t => t);
  }

  /* ---------- extraction: key terms ---------- */
  function extractKeyTerms(text, definitions, topics) {
    return uniqueBy(topics, t => t).slice(0, 8);
  }

  /* ---------- extraction: important notes ---------- */
  function extractImportant(text) {
    const out = [];
    splitSentences(text).forEach(s => {
      if (IMPORTANT_HINTS.some(h => lower(s).includes(h))) {
        const t = s.replace(/^[•\-\d.)\s]+/, '').trim();
        if (!GREETING_RE.test(t)) out.push(truncate(t, 160));
      }
    });
    return uniqueBy(out, t => t).slice(0, 5);
  }

  /* ---------- summary ---------- */
  function buildSummary(text, extras) {
    const sentences = splitSentences(text);
    if (!sentences.length) return { text: '', keywords: [] };

    const scored = sentences.map(s => {
      let score = 0;
      const low = lower(s);
      if (low.includes('важно') || low.includes('ключевой') || low.includes('главное')) score += 3;
      if (DEF_HINTS.some(h => low.includes(h))) score += 2;
      if (FORMULA_HINTS.some(h => s.includes(h))) score += 2;
      if (low.includes('следовательно') || low.includes('итак') || low.includes('таким образом')) score += 2;
      if (TASK_HINTS.some(h => low.includes(h))) score -= 1;
      score += Math.min(s.length / 100, 1);
      return { s, score };
    }).sort((a, b) => b.score - a.score);

    const picked = scored.slice(0, 4).map(x => x.s).sort((a, b) => sentences.indexOf(a) - sentences.indexOf(b));
    const keywords = extractKeywords(text, 6);
    const summaryText = '📌 ' + picked.join('\n');
    return { text: summaryText, keywords };
  }

  /* ---------- keywords ---------- */
  function extractKeywords(text, n) {
    const stop = new Set('это,и,в,на,с,по,для,что,как,при,от,из,за,не,то,все,если,когда,который,которая,которые,также,таким,образом,где,пусть,между,через,можно,будет,есть,или,то,а,но,о,об,до,про'.split(','));
    const words = norm(text).toLowerCase().replace(/[.,:;!?()«»"']/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !stop.has(w) && !/^\d+$/.test(w));
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n || 6)
      .map(e => e[0]);
  }

  /* ---------- helpers for definition-based cards/questions ---------- */
  /* Возвращает true, если в определении встречается само слово термина —
     тогда обратный вопрос «какой термин здесь определён?» тривиален. */
  function definitionRevealsTerm(definition, term) {
    const def = lower(definition);
    const words = lower(term).split(/\s+/).filter(w => w.length > 3);
    return words.some(w => def.includes(w));
  }

  /* ---------- flashcards ---------- */
  function isCleanFlashcard(c) {
    if (!c.question || !c.answer) return false;
    const q = norm(String(c.question));
    const a = norm(String(c.answer));
    if (q.indexOf('|') > -1 || a.indexOf('|') > -1) return false;
    if (hasBrokenHyphen(q + ' ' + a)) return false;
    if (GREETING_RE.test(q + ' ' + a)) return false;
    if (FRAGMENT_RE.test(a)) return false;
    if (q.length < 4 || a.length < 2) return false;
    return true;
  }


  function buildFlashcards(text, topics, definitions, formulas, tasks) {
    const cards = [];

    // definition cards (term -> definition) and reverse (definition -> term)
    definitions.slice(0, 5).forEach(d => {
      if (!d.term || !d.definition) return;
      cards.push({ question: 'Что такое «' + d.term + '»?', answer: d.definition, kind: 'def' });
      if (!definitionRevealsTerm(d.definition, d.term)) {
        cards.push({
          question: 'Какой термин здесь определён?\n' + d.definition,
          answer: d.term,
          kind: 'def'
        });
      }
    });

    // formula cards: description -> formula
    formulas.slice(0, 4).forEach(f => {
      if (!f.formula) return;
      const q = f.description
        ? 'Запиши формулу: ' + f.description
        : 'Вспомни формулу из данного материала';
      cards.push({ question: q, answer: f.formula, kind: 'formula' });
    });

    // definition-based fill-blank: пропущено одно слово термина.
    // Матчим только целое слово (word boundary), чтобы «матрица» не
    // рвала «матрицами» на куски.
    definitions.slice(0, 3).forEach(d => {
      if (!d.term || !d.definition || d.term.length <= 4) return;
      const single = d.term.split(/\s+/);
      if (single.length !== 1) return;
      const word = single[0];
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // границы — только по кириллице/буквенно-цифровым символам
      // (в JS «\b» не работает с кириллицей, поэтому без явных границ
      //  «матрицу» нельзя было бы найти в «матрицами»)
      const re = new RegExp('(^|[^А-ЯЁа-яёA-Za-z0-9])(' + escaped + ')(?=[^А-ЯЁа-яёA-Za-z0-9]|$)', 'gi');
      const matches = d.definition.match(re) || [];
      if (matches.length !== 1) return; // 0 — нет повтора, >1 — неоднозначно
      const fill = d.definition.replace(re, '$1…');
      cards.push({ question: 'Вставь пропущенное слово:\n' + truncate(fill, 150), answer: word, kind: 'def' });
    });

    const clean = cards.filter(isCleanFlashcard);
    if (!clean.length) {
      const fallbackText = truncate(text, 120);
      if (isCleanFlashcard({ question: 'Какой главный вывод этой лекции?', answer: fallbackText })) {
        clean.push({ question: 'Какой главный вывод этой лекции?', answer: fallbackText, kind: 'def' });
      }
    }
    return uniqueBy(clean, c => c.question + '|' + c.answer).slice(0, 12);
  }

  /* ---------- quiz questions ---------- */
  function buildQuiz(text, definitions, formulas, topics, tasks) {
    const questions = [];
    const used = new Set();

    function cleanOption(o) {
      const s = norm(o);
      if (!s || s.length < 2) return null;
      if (s.indexOf('|') > -1) return null;
      if (hasBrokenHyphen(s)) return null;
      if (GREETING_RE.test(s)) return null;
      if (FRAGMENT_RE.test(s)) return null;
      if (s.length > 220) return truncate(s, 220);
      return s;
    }

    function add(q, options, correct) {
      const qc = cleanOption(q);
      if (!qc || used.has(lower(qc)) || correct < 0) return;
      const target = cleanOption(options[correct]);
      if (!target) return;
      const cleaned = [];
      const seen = new Set();
      options.forEach((o, i) => {
        const c = cleanOption(o);
        if (!c) return;
        const k = lower(c);
        if (seen.has(k)) return;
        seen.add(k);
        cleaned.push(c);
      });
      if (cleaned.length < 2) return;
      used.add(lower(qc));
      const shuffled = shuffle(cleaned);
      questions.push({ q: qc, options: shuffled, correct: shuffled.indexOf(target), course: null });
    }

    // definitions: pick the right definition among other real definitions
    definitions.slice(0, 4).forEach(d => {
      if (!d.term || !d.definition) return;
      const q = 'Что такое «' + d.term + '»?';
      const others = definitions.filter(x => x.term !== d.term).map(x => x.definition).filter(Boolean);
      const opts = [d.definition].concat(others.slice(0, 3));
      if (opts.length < 4) opts.push('Определения нет в материале');
      add(q, opts.slice(0, 4), 0);
    });

    // formulas: match formula to description
    formulas.slice(0, 3).forEach(f => {
      if (!f.formula) return;
      const q = f.description
        ? 'Выбери формулу: ' + f.description
        : 'Какая формула упоминалась в материале?';
      const others = formulas.filter(x => x.formula !== f.formula).map(x => x.formula).filter(Boolean);
      const opts = [f.formula].concat(others.slice(0, 3));
      if (opts.length < 3) opts.push('Среди вариантов нет верного');
      add(q, opts.slice(0, 4), 0);
    });

    // definition -> term (reverse quiz)
    definitions.slice(0, 2).forEach(d => {
      if (!d.term || !d.definition) return;
      if (definitionRevealsTerm(d.definition, d.term)) return;
      const q = 'Какой термин соответствует определению?\n' + truncate(d.definition, 100);
      const others = definitions.filter(x => x.term !== d.term).map(x => x.term).filter(Boolean);
      const opts = [d.term].concat(others.slice(0, 3));
      if (opts.length < 4) opts.push('Такого термина нет');
      add(q, opts.slice(0, 4), 0);
    });

    // true/false definition question
    definitions.slice(0, 2).forEach(d => {
      if (!d.term || !d.definition) return;
      const q = 'Верно ли: «' + d.term + '» — это ' + truncate(d.definition, 90) + '?';
      add(q, ['Да', 'Нет'], 0);
    });

    // Никакого мусорного fallback-вопроса: если реальных вопросов нет,
    // отдаём пустой список — на экране будет «Тестов пока нет».
    return questions.slice(0, 6);
  }

  /* ---------- full analysis ---------- */
  function analyze(text) {
    const clean = norm(text);
    const topics = extractTopics(clean);
    const definitions = extractDefinitions(clean);
    const formulas = extractFormulas(clean);
    const tasks = extractTasks(clean);
    const important = extractImportant(clean);
    const summary = buildSummary(clean, { definitions, formulas });
    const flashcards = buildFlashcards(clean, topics, definitions, formulas, tasks);
    const quiz = buildQuiz(clean, definitions, formulas, topics, tasks);

    return {
      text: clean,
      summary: summary.text,
      keywords: summary.keywords,
      topics,
      definitions,
      formulas,
      tasks,
      important,
      flashcards,
      quiz,
      stats: {
        sentences: splitSentences(clean).length,
        words: clean.split(/\s+/).length,
        definitions: definitions.length,
        formulas: formulas.length,
        tasks: tasks.length
      }
    };
  }

  /* ---------- structured notes builder ---------- */
  function buildStructuredNotes(analysis) {
    const blocks = [];

    if (analysis.summary) blocks.push({ type: 'summary', label: 'Конспект', text: analysis.summary });

    if (analysis.definitions.length) {
      blocks.push({ type: 'def', label: 'Определения', items: analysis.definitions.map(d => d.term + ' — ' + d.definition) });
    }

    if (analysis.formulas.length) {
      blocks.push({ type: 'formula', label: 'Формулы', items: analysis.formulas.map(f => f.formula + (f.description ? '  (' + f.description + ')' : '')) });
    }

    if (analysis.tasks.length) {
      blocks.push({ type: 'task', label: 'Задания', items: analysis.tasks });
    }

    if (analysis.keywords.length) {
      blocks.push({ type: 'topic', label: 'Ключевые темы', items: analysis.keywords });
    }

    if (!blocks.length) {
      blocks.push({ type: 'summary', label: 'Конспект', text: analysis.text.slice(0, 400) });
    }
    return blocks;
  }

  global.StudyAnalyzer = {
    analyze,
    buildStructuredNotes,
    extractTopics,
    extractDefinitions,
    extractFormulas,
    extractTasks,
    buildFlashcards,
    buildQuiz
  };
})(window);

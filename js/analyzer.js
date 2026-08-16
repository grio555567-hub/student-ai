/* ===== StudyMind AI — on-device text analyzer =====
   No external AI key needed. Extracts definitions, formulas,
   tasks, topics, key terms from lecture text / materials,
   and generates summaries, flashcards and quiz questions.
*/
(function (global) {
  'use strict';

  /* ---------- raw string helpers ---------- */
  function norm(str) {
    return String(str || '').replace(/\s+/g, ' ').trim();
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

  function truncate(str, n) {
    const s = norm(str);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* ---------- sentencify ---------- */
  function splitSentences(text) {
    return norm(text)
      .replace(/([.!?…])\s+(?=[А-ЯA-Z0-9«"(])/g, '$1\n')
      .split('\n')
      .map(s => norm(s))
      .filter(s => s.length > 12);
  }

  /* ---------- keyword dictionaries ---------- */
  const FORMULA_HINTS = ['формул', 'уравнени', 'равенств', '∫', '∑', '√', 'Δ', 'λ', 'dx', 'dy', '=', 'O(', '∂', 'π', '⁻', 'ⁿ', '²', '³'];
  const DEF_HINTS = [
    'это', '— это', '—это', 'называется', 'называют', 'определяется', 'представляет собой',
    'означает', 'определение', 'определяют', 'характеризует', 'состоит', 'является'
  ];
  const TASK_HINTS = ['задани', 'упражнени', 'решить', 'вычислить', 'найти', 'докажите', 'постройте', 'выведите', 'практик', 'пример'];
  const TOPIC_HINTS = ['тема', 'раздел', 'глава', 'лекция', 'параграф'];
  const IMPORTANT_HINTS = ['важно', 'ключевой', 'ключевые', 'обратите внимание', 'запомните', 'главное', 'суть'];

  /* ---------- extraction: topics ---------- */
  function extractTopics(text) {
    const out = [];
    splitSentences(text).forEach(s => {
      const low = lower(s);
      TOPIC_HINTS.forEach(hint => {
        if (low.includes(hint)) {
          const after = s.split(new RegExp('(' + hint + ')', 'i')).slice(-1)[0];
          const cleaned = after.replace(/^[:\s-]+/, '').replace(/[.:!?]+$/, '');
          if (cleaned.length > 2 && cleaned.length < 90) out.push(cleaned);
        }
      });
    });

    // fallback: pull out bigrams with capital letters (RU/EN)
    const words = norm(text).split(/[ ,;]+/);
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i], b = words[i + 1];
      if (!a || !b) continue;
      if ((isCap(a) && isLowerWord(b) && b.length > 3) || (isCap(a) && isCap(b))) {
        const term = a + ' ' + b;
        if (term.length < 50 && !out.includes(term)) out.push(term);
      }
      if (out.length >= 12) break;
    }
    return uniqueBy(out.slice(0, 12), t => t);
  }

  function isCap(w) {
    return /^[А-ЯA-Z]/.test(w) && w.length > 1 && w === w[0] + w.slice(1).toLowerCase();
  }
  function isLowerWord(w) { return /^[а-яa-z]/.test(w); }

  /* ---------- extraction: definitions ---------- */
  function extractDefinitions(text) {
    const out = [];
    splitSentences(text).forEach(s => {
      const low = lower(s);
      for (const hint of DEF_HINTS) {
        const idx = low.indexOf(hint);
        if (idx < 0) continue;
        const before = s.slice(0, idx).trim();
        const after = s.slice(idx + hint.length).trim();
        let term = before.split(/[.,:;]/).pop().trim();
        term = term.replace(/^(если|пусть|когда|где|который|которая|это)\s+/i, '');
        if (term.length < 130 && term.length > 2 && after.length > 5) {
          out.push({ term: truncate(term, 90), definition: truncate(after.replace(/^[:\s-]+/, ''), 200) });
          break;
        }
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
      // pattern: "Form<la>: expr" or "expr. Formula ..."
      let formula = null;
      const colonMatch = s.match(/[(Фф]ормул[аы]?[^:]{0,10}:\s*([^.;]+)/);
      if (colonMatch) formula = colonMatch[1];
      else {
        const eqMatch = s.match(/([А-ЯA-Za-z0-9()∫∑√πλ∂\s+\-−=·*^²³ⁿ⁻ˣ⁰¹²{}\[\]\\/.'"]{4,60}?=\s*[^.;]+)/);
        if (eqMatch && eqMatch[1].length > 3) formula = eqMatch[1];
      }
      if (formula) {
        let desc = s.replace(formula, '').trim();
        desc = desc.replace(/^[^—:]*[—:]\s*/, '');
        if (desc.length > 120) desc = truncate(desc, 120);
        out.push({ formula: truncate(norm(formula), 120), description: norm(desc).slice(0, 140) });
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
        out.push(truncate(s.replace(/^[•\-\d.)\s]+/, ''), 170));
      }
    });
    return uniqueBy(out, t => t);
  }

  /* ---------- extraction: key terms ---------- */
  function extractKeyTerms(text, definitions, topics) {
    const terms = definitions.map(d => d.term.toLowerCase());
    return uniqueBy(topics, t => t).slice(0, 8);
  }

  /* ---------- extraction: important notes ---------- */
  function extractImportant(text) {
    const out = [];
    splitSentences(text).forEach(s => {
      if (IMPORTANT_HINTS.some(h => lower(s).includes(h))) {
        out.push(truncate(s.replace(/^[•\-\d.)\s]+/, ''), 160));
      }
    });
    return uniqueBy(out, t => t).slice(0, 5);
  }

  /* ---------- summary ---------- */
  function buildSummary(text, extras) {
    const sentences = splitSentences(text);
    if (!sentences.length) return { text: '', keywords: [] };

    // score each sentence
    const scored = sentences.map(s => {
      let score = 0;
      const low = lower(s);
      if (low.includes('важно') || low.includes('ключевой') || low.includes('главное')) score += 3;
      if (DEF_HINTS.some(h => low.includes(h))) score += 2;
      if (FORMULA_HINTS.some(h => s.includes(h))) score += 2;
      if (low.includes('следовательно') || low.includes('итак') || low.includes('таким образом')) score += 2;
      if (TASK_HINTS.some(h => low.includes(h))) score -= 1; // keep summary pure
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
    const stop = new Set('это,и,в,на,с,по,для,что,как,при,от,из,за,не,то,все,если,когда,который,которая,которые,также,таким,образом,где,пусть,между,через,можно,будет,есть,или,то,то,а,но,о,об,до,про'.split(','));
    const words = norm(text).toLowerCase().replace(/[.,:;!?()«»"']/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !stop.has(w) && !/^\d+$/.test(w));
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n || 6)
      .map(e => e[0]);
  }

  /* ---------- flashcards ---------- */
  function buildFlashcards(text, topics, definitions, formulas, tasks) {
    const cards = [];

    definitions.slice(0, 4).forEach(d => {
      cards.push({ question: 'Что такое «' + d.term + '»?', answer: d.definition, kind: 'def' });
      cards.push({ question: 'Определи термин: ' + d.term + ' (перевёрнутая карточка)', answer: d.definition, kind: 'def' });
    });

    formulas.slice(0, 3).forEach(f => {
      cards.push({ question: 'Формула: ' + (f.description || 'вспомни формулу'), answer: f.formula, kind: 'formula' });
    });

    topics.slice(0, 3).forEach(t => {
      cards.push({ question: 'Ключевая тема: ' + t + ' — объясни своими словами', answer: 'Смотри конспект по теме «' + t + '»', kind: 'topic' });
    });

    tasks.slice(0, 2).forEach(t => {
      cards.push({ question: 'Задание: ' + truncate(t, 90), answer: 'Реши задание и сверь с конспектом', kind: 'task' });
    });

    if (!cards.length) {
      cards.push({ question: 'Какой главный вывод этой лекции?', answer: truncate(text, 120), kind: 'def' });
    }
    return uniqueBy(cards, c => c.question).slice(0, 12);
  }

  /* ---------- quiz questions ---------- */
  function buildQuiz(text, definitions, formulas, topics, tasks) {
    const questions = [];
    const used = new Set();

    function add(q, options, correct) {
      const key = q.toLowerCase();
      if (used.has(key) || correct < 0) return;
      used.add(key);
      questions.push({ q, options, correct });
    }

    definitions.slice(0, 3).forEach((d, i) => {
      const q = 'Что такое «' + d.term + '»?';
      const opts = [d.definition, 'Просто последовательность символов', 'Случайное слово из лекции', 'Нет верного ответа'];
      add(q, shuffle(opts), 0);
    });

    formulas.slice(0, 2).forEach(f => {
      add('Какая формула упоминалась в лекции?', shuffle([f.formula, 'a + b = c', 'x = x + 1', '2 + 2 = 5']), 0);
    });

    definitions.slice(0, 2).forEach(d => {
      const q = 'Верно ли: «' + d.term + '» — ' + d.definition + '?';
      add(q, ['Да', 'Нет'], 0);
    });

    topics.slice(0, 2).forEach(t => {
      add('Какая тема была в материале?', shuffle([t, 'Случайный набор слов', 'История искусств', 'Кулинария']), 0);
    });

    if (!questions.length) {
      add('О чём этот материал?', shuffle(['О чём-то важном', 'Ни о чём', 'Обо всём', 'Трудно сказать']), 0);
    }
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

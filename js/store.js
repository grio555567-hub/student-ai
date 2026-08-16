/* ===== StudyMind AI — data layer & storage ===== */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'studymind-state-v1';

  /* ---------- small utils ---------- */
  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function todayStr(offsetDays) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function daysBetween(from, to) {
    const a = new Date(from + 'T12:00:00');
    const b = new Date(to + 'T12:00:00');
    return Math.round((b - a) / 86400000);
  }

  function formatDateRu(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return d.getDate() + ' ' + months[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  }

  function dayNameRu(dateStr) {
    const names = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    return names[new Date(dateStr + 'T12:00:00').getDay()];
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return min + ' мин назад';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' ч назад';
    const d = Math.floor(h / 24);
    return d + ' дн назад';
  }

  /* ---------- knowledge helpers ---------- */
  function computeTopicLevel(scores) {
    if (!scores || scores.length === 0) return 0;
    const sum = scores.reduce((acc, s) => acc + s, 0);
    const avg = sum / scores.length;
    // last answers weigh more: 40% avg, 60% recent trend
    const recent = scores.slice(-5);
    const recAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : avg;
    return Math.round(avg * 0.4 + recAvg * 0.6);
  }

  const LEVEL_LABELS = { 0: 'Новый', 1: 'Начало', 2: 'Базово', 3: 'Уверенно', 4: 'Отлично' };

  /* ---------- default demo state ---------- */
  function demoState() {
    const today = todayStr();
    const examDate = addDays(today, 18);

    const courses = [
      {
        id: 'c-linalg',
        name: 'Линейная алгебра',
        emoji: '🔢',
        color: '#4D96FF',
        examDate: examDate,
        createdAt: Date.now() - 86400000 * 20
      },
      {
        id: 'c-calc',
        name: 'Математический анализ',
        emoji: '📈',
        color: '#FF9F1C',
        examDate: addDays(today, 24),
        createdAt: Date.now() - 86400000 * 20
      },
      {
        id: 'c-prog',
        name: 'Программирование на Java',
        emoji: '☕',
        color: '#06D6A0',
        examDate: addDays(today, 12),
        createdAt: Date.now() - 86400000 * 20
      }
    ];

    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const lessonTpl = [
      { name: 'Математический анализ', type: 'lecture', room: 'А-301', courseId: 'c-calc', time: '09:00' },
      { name: 'Линейная алгебра', type: 'lecture', room: 'А-115', courseId: 'c-linalg', time: '11:00' },
      { name: 'Линейная алгебра', type: 'seminar', room: 'Б-204', courseId: 'c-linalg', time: '13:30' },
      { name: 'Программирование на Java', type: 'lab', room: 'Д-110', courseId: 'c-prog', time: '09:00' },
      { name: 'Математический анализ', type: 'seminar', room: 'А-301', courseId: 'c-calc', time: '11:00' },
      { name: 'Программирование на Java', type: 'lecture', room: 'Д-110', courseId: 'c-prog', time: '15:30' }
    ];
    const schedule = weekDays.map((name, i) => ({
      id: 'd-' + i,
      dayOfWeek: i,
      name: name,
      lessons: lessonTpl.filter((_, j) => (j + i) % 2 === 0).map((l, k) => ({
        id: 'l-' + i + '-' + k,
        name: l.name,
        type: l.type,
        room: l.room,
        courseId: l.courseId,
        time: (parseInt(l.time.slice(0, 2)) + Math.floor(i / 2)) + ':' + l.time.slice(3),
        done: false
      }))
    }));

    const topics = {
      'c-linalg': [
        { id: 't-l1', name: 'Матрицы и операции', level: 3 },
        { id: 't-l2', name: 'Определители', level: 2 },
        { id: 't-l3', name: 'Системы линейных уравнений', level: 2 },
        { id: 't-l4', name: 'Собственные значения', level: 1 }
      ],
      'c-calc': [
        { id: 't-c1', name: 'Пределы', level: 3 },
        { id: 't-c2', name: 'Производные', level: 2 },
        { id: 't-c3', name: 'Интегралы', level: 1 },
        { id: 't-c4', name: 'Ряды', level: 1 }
      ],
      'c-prog': [
        { id: 't-p1', name: 'Синтаксис и типы', level: 3 },
        { id: 't-p2', name: 'ООП: классы и объекты', level: 2 },
        { id: 't-p3', name: 'Исключения', level: 1 },
        { id: 't-p4', name: 'Коллекции', level: 2 }
      ]
    };

    const notes = [
      {
        id: 'n-1',
        courseId: 'c-linalg',
        title: 'Лекция: Собственные значения',
        kind: 'lecture',
        text: 'Собственный вектор — ненулевой вектор v, который при умножении на матрицу A превращается в λv. Характеристическое уравнение det(A − λE) = 0. Собственные значения находятся из этого уравнения. Формула: A·v = λ·v. Задание: найти собственные значения матрицы 2×2. Тема: собственные значения.',
        ts: Date.now() - 86400000 * 3,
        durSec: 3240
      },
      {
        id: 'n-2',
        courseId: 'c-calc',
        title: 'Лекция: Интегралы',
        kind: 'lecture',
        text: 'Определённый интеграл — площадь под кривой. Формула Ньютона-Лейбница: ∫f(x)dx = F(b) − F(a). Интегрирование по частям: ∫u dv = uv − ∫v du. Задание: вычислить ∫x·eˣ dx. Тема: интегралы.',
        ts: Date.now() - 86400000 * 2,
        durSec: 2880
      },
      {
        id: 'n-3',
        courseId: 'c-prog',
        title: 'Конспект: Коллекции Java',
        kind: 'lecture',
        text: 'ArrayList — динамический массив, LinkedList — двусвязный список. HashMap хранит пары ключ-значение. Определение: коллекция — объект, группирующий множество элементов. Формула сложности: добавление в ArrayList O(1) среднее. Задание: выбрать коллекцию для частого поиска по ключу. Тема: коллекции.',
        ts: Date.now() - 86400000 * 1,
        durSec: 2100
      }
    ];

    const materials = [
      {
        id: 'm-1',
        courseId: 'c-linalg',
        name: 'Лекции_линал.pdf',
        emoji: '📄',
        kind: 'pdf',
        text: 'Матрицы и операции: сложение, умножение, транспонирование. Определитель матрицы 2×2: ad − bc. Собственные значения и векторы: A·v = λ·v. Задание: вычислить определитель матрицы. Тема: матрицы.',
        ts: Date.now() - 86400000 * 6
      },
      {
        id: 'm-2',
        courseId: 'c-calc',
        name: 'Интегралы_презентация.pptx',
        emoji: '📊',
        kind: 'ppt',
        text: 'Первообразная и неопределённый интеграл. Формула Ньютона-Лейбница: ∫f(x)dx = F(b) − F(a). Задание: найти первообразную для x². Тема: интегралы.',
        ts: Date.now() - 86400000 * 4
      }
    ];

    const flashcards = [
      { id: 'f-1', courseId: 'c-linalg', topicId: 't-l4', question: 'Что такое собственный вектор?', answer: 'Ненулевой вектор v, при умножении на который матрица A даёт λv: A·v = λ·v', kind: 'def' },
      { id: 'f-2', courseId: 'c-linalg', topicId: 't-l2', question: 'Определитель матрицы 2×2 [a b; c d]', answer: 'ad − bc', kind: 'formula' },
      { id: 'f-3', courseId: 'c-calc', topicId: 't-c3', question: 'Формула Ньютона-Лейбница', answer: '∫ₐᵇ f(x)dx = F(b) − F(a)', kind: 'formula' },
      { id: 'f-4', courseId: 'c-prog', topicId: 't-p1', question: 'Назови 5 примитивных типов Java', answer: 'int, double, boolean, char, long', kind: 'def' },
      { id: 'f-5', courseId: 'c-prog', topicId: 't-p4', question: 'Какая коллекция хранит пары «ключ-значение»?', answer: 'HashMap', kind: 'def' },
      { id: 'f-6', courseId: 'c-calc', topicId: 't-c2', question: 'Производная xⁿ', answer: 'n·xⁿ⁻¹', kind: 'formula' }
    ];

    const quizzes = [
      {
        id: 'q-1',
        courseId: 'c-linalg',
        topicId: 't-l2',
        title: 'Проверка: определители',
        questions: [
          { q: 'Определитель матрицы [[1,2],[3,4]]', options: ['−2', '10', '−5', '7'], correct: 0 },
          { q: 'Определитель единичной матрицы 3×3', options: ['0', '1', '3', '−1'], correct: 1 }
        ]
      },
      {
        id: 'q-2',
        courseId: 'c-prog',
        topicId: 't-p1',
        title: 'Проверка: Java основы',
        questions: [
          { q: 'Какой метод — точка входа в Java?', options: ['run()', 'start()', 'main()', 'init()'], correct: 2 },
          { q: 'Какой из типов — ссылочный?', options: ['int', 'String', 'double', 'boolean'], correct: 1 }
        ]
      }
    ];

    const knowledge = {
      't-l4': [{ score: 1, ts: Date.now() - 86400000 * 3 }, { score: 1, ts: Date.now() - 86400000 * 2 }],
      't-c3': [{ score: 1, ts: Date.now() - 86400000 * 2 }],
      't-p3': [{ score: 0, ts: Date.now() - 86400000 * 1 }],
      't-l2': [{ score: 2, ts: Date.now() - 86400000 * 5 }]
    };

    const mistakes = [
      { id: 'err-1', courseId: 'c-linalg', topicId: 't-l4', text: 'Перепутал собственный вектор с собственным значением', ts: Date.now() - 86400000 * 3 },
      { id: 'err-2', courseId: 'c-calc', topicId: 't-c3', text: 'Ошибка в формуле Ньютона-Лейбница', ts: Date.now() - 86400000 * 2 }
    ];

    const deadlines = [
      { id: 'dl-1', courseId: 'c-prog', title: 'Лабораторная 4: коллекции', date: addDays(today, 3) },
      { id: 'dl-2', courseId: 'c-calc', title: 'Домашнее задание: интегралы', date: addDays(today, 5) }
    ];

    return {
      version: 1,
      profile: { name: 'Студент', streak: 4, lastStudyDay: todayStr(-1) },
      courses: courses,
      schedule: schedule,
      topics: topics,
      notes: notes,
      materials: materials,
      flashcards: flashcards,
      quizzes: quizzes,
      knowledge: knowledge,
      mistakes: mistakes,
      deadlines: deadlines,
      plan: null,
      planDone: {},
      settings: { recordingEnabled: false }
    };
  }

  /* ---------- store ---------- */
  const Store = {
    state: null,

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.state = JSON.parse(raw);
          // defensive: repair partially-broken old states
          if (!this.state.topics) this.state.topics = {};
          if (!this.state.planDone) this.state.planDone = {};
          if (!this.state.knowledge) this.state.knowledge = {};
          if (!this.state.flashcards) this.state.flashcards = [];
          if (!this.state.quizzes) this.state.quizzes = [];
          if (!this.state.notes) this.state.notes = [];
          if (!this.state.materials) this.state.materials = [];
          if (!this.state.mistakes) this.state.mistakes = [];
          if (!this.state.deadlines) this.state.deadlines = [];
          if (!this.state.courses) this.state.courses = [];
          if (!this.state.schedule) this.state.schedule = [];
          if (!this.state.profile || typeof this.state.profile !== 'object') {
            this.state.profile = { name: 'Студент', streak: 0, lastStudyDay: null };
          }
          this.save();
          return;
        }
      } catch (e) { /* corrupted -> fresh */ }
      this.state = demoState();
      this.save();
    },

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        console.warn('Save failed', e);
      }
    },

    resetDemo() {
      this.state = demoState();
      this.save();
    },

    clearAll() {
      this.state = {
        version: 1,
        profile: { name: 'Студент', streak: 0, lastStudyDay: null },
        courses: [], schedule: [], topics: {}, notes: [], materials: [],
        flashcards: [], quizzes: [], knowledge: {}, mistakes: [],
        deadlines: [], plan: null, planDone: {}, settings: {}
      };
      this.save();
    },

    /* courses */
    getCourse(id) { return this.state.courses.find(c => c.id === id); },
    addCourse(name, emoji, examDate) {
      const c = { id: uid('c'), name: name, emoji: emoji || '📘', color: '#4D96FF', examDate: examDate || null, createdAt: Date.now() };
      this.state.courses.push(c);
      this.state.topics[c.id] = [];
      this.save();
      return c;
    },
    deleteCourse(id) {
      this.state.courses = this.state.courses.filter(c => c.id !== id);
      delete this.state.topics[id];
      this.state.notes = this.state.notes.filter(n => n.courseId !== id);
      this.state.materials = this.state.materials.filter(m => m.courseId !== id);
      this.state.flashcards = this.state.flashcards.filter(f => f.courseId !== id);
      this.state.quizzes = this.state.quizzes.filter(q => q.courseId !== id);
      this.state.deadlines = this.state.deadlines.filter(d => d.courseId !== id);
      this.save();
    },

    /* topics */
    topicScores(courseId) {
      const list = this.state.topics[courseId] || [];
      return list.map(t => ({ ...t, level: this.topicLevel(t.id) }));
    },
    topicLevel(topicId) {
      const scores = (this.state.knowledge[topicId] || []).map(k => k.score);
      return computeTopicLevel(scores);
    },
    ensureTopics(courseId, names) {
      const list = this.state.topics[courseId] || (this.state.topics[courseId] = []);
      let changed = false;
      names.forEach(name => {
        if (!list.some(t => t.name.toLowerCase() === name.toLowerCase())) {
          list.push({ id: uid('t'), name: name, level: 0 });
          changed = true;
        }
      });
      if (changed) this.save();
    },

    /* recording / notes */
    addNote(courseId, title, kind, text, durSec) {
      const note = { id: uid('n'), courseId: courseId, title: title, kind: kind, text: text, ts: Date.now(), durSec: durSec || 0 };
      this.state.notes.unshift(note);
      this.save();
      return note;
    },
    deleteNote(id) {
      this.state.notes = this.state.notes.filter(n => n.id !== id);
      this.save();
    },

    /* materials */
    addMaterial(courseId, name, kind, text) {
      const m = { id: uid('m'), courseId: courseId, name: name, emoji: kind === 'ppt' ? '📊' : '📄', kind: kind, text: text, ts: Date.now() };
      this.state.materials.unshift(m);
      this.save();
      return m;
    },
    deleteMaterial(id) {
      this.state.materials = this.state.materials.filter(m => m.id !== id);
      this.save();
    },

    /* cards & quizzes */
    addFlashcards(courseId, topicId, cards) {
      cards.forEach(card => this.state.flashcards.push({ id: uid('f'), courseId: courseId, topicId: topicId, ...card }));
      this.save();
    },
    addQuiz(courseId, topicId, questions) {
      const quiz = { id: uid('q'), courseId: courseId, topicId: topicId, title: 'Проверка: ' + (this.topicName(topicId) || 'тема'), questions: questions };
      this.state.quizzes.unshift(quiz);
      this.save();
      return quiz;
    },
    topicName(topicId) {
      for (const list of Object.values(this.state.topics)) {
        const t = list.find(t => t.id === topicId);
        if (t) return t.name;
      }
      return null;
    },

    /* knowledge / mistakes */
    recordAnswer(topicId, score) {
      (this.state.knowledge[topicId] = this.state.knowledge[topicId] || []).push({ score: score, ts: Date.now() });
      this.addStreakPoint();
      this.save();
    },
    addMistake(courseId, topicId, text) {
      this.state.mistakes.unshift({ id: uid('err'), courseId: courseId, topicId: topicId, text: text, ts: Date.now() });
      this.save();
    },

    /* streak */
    addStreakPoint() {
      const today = todayStr();
      const p = this.state.profile;
      if (p.lastStudyDay === today) return;
      if (p.lastStudyDay === todayStr(-1)) p.streak += 1;
      else p.streak = 1;
      p.lastStudyDay = today;
    },

    /* plan */
    setPlan(plan) {
      this.state.plan = plan;
      this.save();
    },
    getPlan() { return this.state.plan; },
    markPlanDay(date, courseId, topicId, done) {
      const key = date + '|' + topicId;
      if (done) this.state.planDone[key] = true;
      else delete this.state.planDone[key];
      this.save();
    },
    isPlanDayDone(date, topicId) {
      return !!this.state.planDone[date + '|' + topicId];
    },

    /* stats */
    courseKnowledge(courseId) {
      const topics = this.topicScores(courseId);
      if (!topics.length) return 0;
      const sum = topics.reduce((acc, t) => acc + t.level, 0);
      return sum / (topics.length * 4);
    },
    overallKnowledge() {
      const cids = this.state.courses.map(c => c.id);
      if (!cids.length) return 0;
      const sums = cids.map(id => this.courseKnowledge(id));
      return sums.reduce((a, b) => a + b, 0) / cids.length;
    },
    weakTopics(limit) {
      const out = [];
      this.state.courses.forEach(c => {
        this.topicScores(c.id).forEach(t => {
          if (t.level < 2) out.push({ ...t, courseId: c.id, courseName: c.name, emoji: c.emoji });
        });
      });
      out.sort((a, b) => a.level - b.level);
      return out.slice(0, limit || 5);
    },

    /* deadlines */
    addDeadline(courseId, title, date) {
      this.state.deadlines.push({ id: uid('dl'), courseId: courseId, title: title, date: date });
      this.save();
    },
    deleteDeadline(id) {
      this.state.deadlines = this.state.deadlines.filter(d => d.id !== id);
      this.save();
    },

    /* next lesson from schedule */
    nextLesson() {
      const today = todayStr();
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      for (let i = 0; i < 14; i++) {
        const day = this.state.schedule.find(d => d.name === dayNameRu(addDays(today, i)).slice(0, 2)
                                              || d.name === ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][new Date(addDays(today, i) + 'T12:00:00').getDay()]);
        if (!day) continue;
        const future = day.lessons.filter(l => {
          const hm = l.time.split(':');
          const mins = parseInt(hm[0]) * 60 + parseInt(hm[1]);
          return i > 0 || mins > nowMin;
        });
        if (future.length) {
          future.sort((a, b) => a.time.localeCompare(b.time));
          return { ...future[0], date: addDays(today, i), dayName: day.name };
        }
      }
      return null;
    }
  };

  /* ---------- exported API ---------- */
  const StudyStore = {
    ...Store,
    utils: {
      uid: uid,
      todayStr: todayStr,
      addDays: addDays,
      daysBetween: daysBetween,
      formatDateRu: formatDateRu,
      dayNameRu: dayNameRu,
      timeAgo: timeAgo,
      computeTopicLevel: computeTopicLevel,
      LEVEL_LABELS: LEVEL_LABELS
    }
  };

  global.StudyStore = StudyStore;
})(window);

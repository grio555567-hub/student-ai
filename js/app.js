/* ===== StudyMind AI - UI & app logic ===== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var root = $('#screen-root');
  var modalRoot = $('#modal-root');
  var toastRoot = $('#toast-root');
  var navButtons = $$$('.nav-btn');

  var currentView = 'home';
  var currentCourseId = null;

  /* ================= esc ================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, '');
  }

  /* ================= toasts ================= */
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    toastRoot.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2200);
    setTimeout(function () { el.remove(); }, 2600);
  }

  /* ================= modal system ================= */
  function openModal(title, bodyHtml, onMount) {
    modalRoot.innerHTML =
      '<div class="modal-backdrop" data-close></div>' +
      '<div class="modal-sheet">' +
      '<div class="modal-handle"></div>' +
      '<div class="modal-title">' + esc(title) + '</div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      '</div>';
    modalRoot.classList.add('open');
    modalRoot.querySelector('[data-close]').addEventListener('click', closeModal);
    if (onMount) onMount(modalRoot);
  }

  function closeModal() {
    modalRoot.classList.remove('open');
    modalRoot.innerHTML = '';
  }

  function confirmDialog(title, text, onYes) {
    openModal(title,
      '<p class="muted" style="margin-bottom:14px">' + esc(text) + '</p>' +
      '<div class="form-row">' +
      '<button class="btn btn-danger btn-block" id="dlg-yes">Да, удалить</button>' +
      '<button class="btn btn-block" data-close-btn>Отмена</button>' +
      '</div>',
      function (m) {
        m.querySelector('#dlg-yes').addEventListener('click', function () { closeModal(); onYes(); });
        m.querySelector('[data-close-btn]').addEventListener('click', closeModal);
      });
  }

  /* ================= autopilot refresh ================= */
  function refreshAutopilot() {
    var plan = StudyPlanner.generatePlan(14);
    S().setPlan(plan);
  }

  /* ================= data ================= */
  function S() { return StudyStore; }
  function U() { return StudyStore.utils; }

  var TYPE_LABELS = { lecture: 'Лекция', seminar: 'Семинар', lab: 'Лаб', exam: 'Экзамен' };
  var TYPE_CLASS = { lecture: 'type-lecture', seminar: 'type-seminar', lab: 'type-lab', exam: 'type-exam' };

  function courseName(courseId) {
    var c = S().getCourse(courseId);
    return c ? c.name : '-';
  }

  function levelBadge(level) {
    var cls = level <= 1 ? 'level-low' : level === 2 ? 'level-mid' : 'level-good';
    return '<span class="chip ' + cls + '">' + U().LEVEL_LABELS[level] + '</span>';
  }

  /* Russian plural: plural(1,'конспект','конспекта','конспектов') -> "конспект" */
  function plural(n, one, few, many) {
    var abs = Math.abs(n) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  /* ================= navigation ================= */
  function go(view, param) {
    currentView = view;
    currentCourseId = param || null;
    navButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    render(view);
    root.scrollTop = 0;
  }

  function render(view) {
    var map = {
      home: renderHome,
      schedule: renderSchedule,
      record: renderRecord,
      courses: renderCourses,
      autopilot: renderAutopilot,
      course: renderCourseDetail
    };
    var fn = map[view] || renderHome;
    root.innerHTML = '<div class="screen"></div>';
    var screen = root.firstChild;
    screen.innerHTML = fn();
    if (view === 'record') initRecorder(screen);
    bindScreenEvents(screen);
    updateStreak();
  }

  function bindScreenEvents(screen) {
    $$$('[data-nav]', screen).forEach(function (el) {
      el.addEventListener('click', function () { go(el.dataset.nav); });
    });
    $$$('[data-course]', screen).forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-delete-course],[data-delete-note],[data-delete-material]')) return;
        go('course', el.dataset.course);
      });
    });
    $$$('[data-cards]', screen).forEach(function (el) {
      el.addEventListener('click', function () { openPractice(el.dataset.cards); });
    });
    $$$('[data-delete-note]', screen).forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDialog('Удалить запись?', 'Это действие нельзя отменить.', function () {
          S().deleteNote(el.dataset.deleteNote);
          render(currentView);
          toast('Запись удалена', 'success');
        });
      });
    });
    $$$('[data-delete-material]', screen).forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDialog('Удалить материал?', 'Это действие нельзя отменить.', function () {
          S().deleteMaterial(el.dataset.deleteMaterial);
          render(currentView);
          toast('Материал удалён', 'success');
        });
      });
    });
    $$$('[data-plan-done]', screen).forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var parts = el.dataset.planDone.split('|');
        var done = !S().isPlanDayDone(parts[0], parts[1]);
        S().markPlanDay(parts[0], parts[1], parts[2], done);
        toast(done ? 'Миссия выполнена!' : 'Миссия снята');
        render(currentView);
      });
    });
  }

  function updateStreak() {
    $('#streak-count').textContent = (S().state.profile.streak || 0) + '';
  }

  /* ================= HOME ================= */
  function renderHome() {
    var state = S().state;
    var next = S().nextLesson();
    var weak = S().weakTopics(3);
    var plan = StudyPlanner.ensurePlan();
    var mission = StudyPlanner.todayMission(plan);
    var knowledge = Math.round(S().overallKnowledge() * 100);
    var today = U().todayStr();
    var deadline = state.deadlines
      .filter(function (d) { return d.date >= today; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); })[0];

    var nextHtml;
    if (next) {
      nextHtml =
        '<div class="lesson next">' +
        '<span class="lesson-time">' + esc(next.time) + '</span>' +
        '<span class="lesson-name">' + esc(next.name) + '</span>' +
        '<span class="lesson-room">' + esc(next.room || '') + '</span>' +
        '<span class="lesson-type ' + TYPE_CLASS[next.type] + '">' + TYPE_LABELS[next.type] + '</span>' +
        '</div>';
    } else {
      nextHtml = '<p class="muted">Пар на сегодня больше нет</p>';
    }

    var missionHtml = '';
    if (mission) {
      var done = S().isPlanDayDone(mission.date, mission.topicId);
      missionHtml =
        '<div class="mission-card">' +
        '<div class="mission-top">' +
        '<span class="mission-emoji">' + (mission.courseEmoji || '') + '</span>' +
        '<span class="mission-title">' + esc(mission.topicName) + '</span>' +
        (done ? '<span class="tag tag-green">готово</span>' : '<span class="tag tag-red">сегодня</span>') +
        '</div>' +
        '<div class="mission-topic">' + esc(mission.courseName) + ' · ' + esc(mission.goal) + '</div>' +
        '<div class="mission-time"><span>' + mission.totalMinutes + ' мин</span><span>' + esc(U().formatDateRu(mission.date)) + '</span></div>' +
        '<button class="btn btn-sm btn-block" style="margin-top:10px" data-nav="autopilot">Открыть в Автопилоте</button>' +
        '</div>';
    }

    var deadlineHtml = '';
    if (deadline) {
      var left = U().daysBetween(today, deadline.date);
      var cls = left <= 2 ? 'tag-red' : left <= 4 ? 'tag-yellow' : 'tag-green';
      deadlineHtml =
        '<div class="row-between">' +
        '<span>' + esc(deadline.title) + ' <span class="muted">· ' + esc(courseName(deadline.courseId)) + '</span></span>' +
        '<span class="tag ' + cls + '">' + (left === 0 ? 'сегодня!' : left + ' дн') + '</span>' +
        '</div>';
    }

    var weakHtml = weak.length
      ? weak.map(function (w) {
          return '<div class="weak-topic" data-course="' + w.courseId + '">' +
            '<span class="wt-emoji">' + (w.emoji || '') + '</span>' +
            '<span class="wt-name">' + esc(w.name) + '</span>' +
            '<span class="wt-level level-low">' + U().LEVEL_LABELS[w.level] + '</span></div>';
        }).join('')
      : '<div class="empty"><div class="empty-emoji">⭐</div><div class="empty-title">Слабых тем нет</div></div>';

    return '' +
      heroBlock() +
      '<div class="section-label">Твой прогресс</div>' +
      '<div class="stat-grid">' +
      '<div class="stat-box"><div class="stat-num">' + knowledge + '%</div><div class="stat-label">Знания</div></div>' +
      '<div class="stat-box"><div class="stat-num">' + state.flashcards.length + '</div><div class="stat-label">Карточки</div></div>' +
      '<div class="stat-box"><div class="stat-num">' + state.notes.length + '</div><div class="stat-label">Конспекты</div></div>' +
      '<div class="stat-box"><div class="stat-num">' + state.mistakes.length + '</div><div class="stat-label">Ошибки</div></div>' +
      '</div>' +
      (mission ? '<div class="section-label">Миссия на сегодня</div>' + missionHtml : '') +
      '<div class="section-label">Следующая пара</div>' +
      '<div class="card">' + nextHtml + '</div>' +
      (deadline ? '<div class="section-label">Ближайший дедлайн</div><div class="card">' + deadlineHtml + '</div>' : '') +
      '<div class="section-label">Слабые темы</div>' + weakHtml +
      '<div class="section-label">AI-помощник</div>' +
      '<div class="card">' +
      '<p class="muted" style="margin-bottom:10px">Запиши лекцию или вставь текст — приложение сделает конспект, карточки и тест.</p>' +
      '<div class="form-row">' +
      '<button class="btn btn-primary btn-block" data-nav="record">Записать</button>' +
      '<button class="btn btn-blue btn-block" data-nav="record">Вставить текст</button>' +
      '</div></div>';
  }

  function heroBlock() {
    var h = new Date().getHours();
    var greet = h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    return '<div class="hero">' +
      '<div class="hero-title">' + greet + '!</div>' +
      '<div class="hero-text">' + esc(S().state.profile.name || 'Студент') + ', твой экзаменационный автопилот готов к работе.</div>' +
      '<div class="hero-actions">' +
      '<button class="btn btn-block" data-nav="autopilot">Автопилот</button>' +
      '<button class="btn btn-block" data-nav="schedule">Расписание</button>' +
      '</div></div>';
  }

  /* ================= SCHEDULE ================= */
  function renderSchedule() {
    var state = S().state;
    var today = U().todayStr();
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    var dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    var variants = [
      { name: 'Математический анализ', type: 'lecture', room: 'А-301', courseId: 'c-calc', time: '09:00' },
      { name: 'Линейная алгебра', type: 'lecture', room: 'А-115', courseId: 'c-linalg', time: '11:00' },
      { name: 'Линейная алгебра', type: 'seminar', room: 'Б-204', courseId: 'c-linalg', time: '13:30' },
      { name: 'Программирование на Java', type: 'lab', room: 'Д-110', courseId: 'c-prog', time: '09:00' },
      { name: 'Математический анализ', type: 'seminar', room: 'А-301', courseId: 'c-calc', time: '11:00' },
      { name: 'Программирование на Java', type: 'lecture', room: 'Д-110', courseId: 'c-prog', time: '15:30' }
    ];

    var html = '<h1 class="title">Расписание</h1><p class="subtitle">Неделя со ' + esc(U().formatDateRu(today)) + '</p>';

    for (var i = 0; i < 7; i++) {
      var date = U().addDays(today, i);
      var dow = new Date(date + 'T12:00:00').getDay();
      var name = dayNames[dow];
      var day = state.schedule.find(function (d) { return d.name === name; });
      if (!day) continue;
      var tutorial = (day.lessons || []);
      html += '<div class="day-card card"><div class="day-head">' +
        '<span class="day-name">' + (i === 0 ? 'Сегодня' : name) + '</span>' +
        '<span class="day-count">' + esc(U().formatDateRu(date)) + '</span></div>';

      state.courses.forEach(function (c) {
        if (c.examDate === date) {
          html += '<div class="lesson" data-course="' + c.id + '">' +
            '<span class="lesson-time">Экзамен</span>' +
            '<span class="lesson-name">' + c.emoji + ' ' + esc(c.name) + '</span>' +
            '<span class="lesson-type type-exam">Экзамен</span></div>';
        }
      });

      if (tutorial.length) {
        tutorial.forEach(function (l, idx) {
          var v = variants[(idx + dow) % variants.length];
          var hm = (l.time || v.time).split(':');
          var mins = parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
          var isNext = i === 0 && mins > nowMin;
          html += '<div class="lesson ' + (isNext ? 'next' : '') + '" data-course="' + (l.courseId || v.courseId) + '">' +
            '<span class="lesson-time">' + esc(l.time || v.time) + '</span>' +
            '<span class="lesson-name">' + esc(l.name || v.name) + '</span>' +
            '<span class="lesson-room">' + esc(l.room || v.room) + '</span>' +
            '<span class="lesson-type ' + TYPE_CLASS[l.type || v.type] + '">' + TYPE_LABELS[l.type || v.type] + '</span></div>';
        });
      }
      html += '</div>';
    }

    html += '<button class="btn btn-primary btn-block" id="add-lesson">Добавить свою пару</button>';
    return html;
  }

  /* ================= RECORD ================= */
  function renderRecord() {
    var supportsSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    var warn = supportsSpeech
      ? ''
      : '<p class="rec-warn">⚠ Браузер не поддерживает распознавание речи. Используй вставку текста.</p>';
    return '' +
      '<h1 class="title">Запись лекции</h1>' +
      '<p class="subtitle">Запиши голос или вставь текст — AI сделает конспект, карточки и тест.</p>' +
      '<div class="card recorder">' +
      '<div class="pulse-rec" id="rec-toggle">🎙</div>' +
      '<div class="rec-timer" id="rec-timer">00:00</div>' +
      '<div class="rec-status" id="rec-status">Нажми, чтобы начать запись</div>' +
      '<div class="live-note hidden" id="live-note"></div>' +
      warn +
      '<div class="field" style="margin-top:12px"><label>Курс</label><select class="select" id="rec-course">' + courseOptions() + '</select></div>' +
      '<div class="field"><label>Название</label><input class="input" id="rec-title" placeholder="Лекция 5 — Интегралы"></div>' +
      '</div>' +
      '<div class="section-label">Или вставь текст</div>' +
      '<div class="card">' +
      '<textarea class="textarea" id="paste-text" placeholder="Вставь сюда текст лекции..."></textarea>' +
      '<button class="btn btn-green btn-block" style="margin-top:10px" id="paste-analyze">AI-анализ</button>' +
      '</div>' +
      '<div class="section-label">Или загрузи материал</div>' +
      '<div class="card">' +
      '<button class="btn btn-blue btn-block" id="import-material">Импорт PDF / PPT / TXT</button>' +
      '<p class="muted center-txt" style="margin-top:8px">Выбери файл — приложение извлечёт определения, формулы и задания.</p>' +
      '</div>';
  }

  function courseOptions(selected) {
    var courses = S().state.courses;
    if (!courses.length) return '<option value="">- создай курс -</option>';
    return courses.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' + c.emoji + ' ' + esc(c.name) + '</option>';
    }).join('');
  }

  function initRecorder(screen) {
    var toggle = screen.querySelector('#rec-toggle');
    var timer = screen.querySelector('#rec-timer');
    var status = screen.querySelector('#rec-status');
    var interval = null;
    var seconds = 0;
    var transcript = '';
    var recognition = null;
    var liveNote = screen.querySelector('#live-note');

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    function fmt(s) {
      var m = Math.floor(s / 60);
      var sec = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function stopRecording(finalize) {
      clearInterval(interval);
      interval = null;
      if (recognition) {
        try { recognition.stop(); } catch (e) {}
        recognition = null;
      }
      toggle.textContent = '🎙';
      toggle.style.animation = '';

      var courseId = screen.querySelector('#rec-course').value;
      var title = screen.querySelector('#rec-title').value || 'Запись лекции';
      var course = S().getCourse(courseId);
      var courseName = course ? course.name : 'Лекция';

      var raw = transcript.trim();
      if (!raw && finalize) {
        status.textContent = 'Ничего не распознано. Попробуй ещё раз или вставь текст.';
        return;
      }
      if (!raw) {
        raw = 'Слушаю лекцию. ' + courseName + '. ' + title + '. ' +
          'Сегодня разбирали ключевые понятия: ' + courseName + ', определения, формулы и задания. ' +
          'Важно: повторить материал и сделать конспект. ' +
          'Определение: конспект — краткое структурированное изложение материала. ' +
          'Формула: E = m·c^2. ' +
          'Задание: решить задачи по теме и проверить себя. Тема: ' + courseName + '.';
      }

      status.textContent = 'Обработка...';
      processLectureText(courseId, title, raw, seconds);
    }

    toggle.addEventListener('click', function () {
      if (interval) { stopRecording(false); return; }

      var courseId = screen.querySelector('#rec-course').value;
      if (!courseId) { toast('Сначала создай курс', 'error'); return; }

      if (!SR) {
        toast('Распознавание речи недоступно в этом браузере', 'error');
        return;
      }

      seconds = 0;
      transcript = '';
      timer.textContent = '00:00';
      toggle.textContent = 'Стоп';
      toggle.style.animation = 'none';
      status.textContent = 'Идёт запись... говори спокойно';

      recognition = new SR();
      recognition.lang = 'ru-RU';
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onresult = function (event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var res = event.results[i];
          if (res.isFinal) transcript += (transcript ? ' ' : '') + res[0].transcript;
          else interim += res[0].transcript;
        }
        var shown = transcript + (interim ? ' ' + interim : '');
        if (liveNote) {
          if (shown.trim()) {
            liveNote.classList.remove('hidden');
            liveNote.textContent = shown;
            liveNote.scrollTop = liveNote.scrollHeight;
          } else {
            liveNote.classList.add('hidden');
          }
        }
      };

      recognition.onerror = function (event) {
        var msg = event.error === 'not-allowed'
          ? 'Доступ к микрофону запрещён'
          : event.error === 'no-speech'
            ? 'Не слышу речь'
            : 'Ошибка распознавания: ' + event.error;
        status.textContent = msg;
        stopRecording(false);
        toast(msg, 'error');
      };

      recognition.onend = function () {
        if (interval) stopRecording(true);
      };

      try {
        recognition.start();
        interval = setInterval(function () {
          seconds++;
          timer.textContent = fmt(seconds);
        }, 1000);
        toast('Запись началась');
      } catch (e) {
        status.textContent = 'Не удалось запустить запись';
        toast('Не удалось запустить запись', 'error');
      }
    });

    screen.querySelector('#paste-analyze').addEventListener('click', function () {
      var courseId = screen.querySelector('#rec-course').value;
      var raw = screen.querySelector('#paste-text').value.trim();
      if (!courseId) { toast('Сначала выбери курс', 'error'); return; }
      if (!raw) { toast('Вставь текст', 'error'); return; }
      processLectureText(courseId, screen.querySelector('#rec-title').value || 'Конспект из текста', raw, 0);
    });

    screen.querySelector('#import-material').addEventListener('click', openImportMaterialModal);
  }

  /* ================= text analysis pipeline ================= */
  function processLectureText(courseId, title, rawText, durSec) {
    var analysis = StudyAnalyzer.analyze(rawText);
    var topicNames = analysis.topics.length ? analysis.topics : analysis.keywords.slice(0, 3);
    if (topicNames.length) S().ensureTopics(courseId, topicNames);

    var topicList = S().topicScores(courseId);
    var mainTopic = topicList[0] ? topicList[0].id : null;

    if (analysis.flashcards.length) S().addFlashcards(courseId, mainTopic, analysis.flashcards);
    if (analysis.quiz.length) S().addQuiz(courseId, mainTopic, analysis.quiz);

    var structured = StudyAnalyzer.buildStructuredNotes(analysis);
    var noteText = formatStructured(structured);
    var note = S().addNote(courseId, title, 'lecture', noteText, durSec);

    refreshAutopilot();
    openNoteResult(note, analysis, structured);
    render('home');
  }

  function formatStructured(blocks) {
    return blocks.map(function (b) {
      if (b.items) return b.label + ':\n' + b.items.map(function (i) { return ' • ' + i; }).join('\n');
      return b.text;
    }).join('\n\n');
  }

  function openNoteResult(note, analysis, structured) {
    var blocksHtml = structured.map(function (b) {
      if (b.items) {
        var cls = b.type === 'def' ? 'nr-def' : b.type === 'formula' ? 'nr-formula' : b.type === 'task' ? 'nr-task' : 'nr-topic';
        return '<div class="section-label">' + esc(b.label) + ' (' + b.items.length + ')</div>' +
          b.items.map(function (item) {
            return '<div class="note-row"><span class="nr-label">' + esc(b.type) + '</span><span class="' + cls + '">' + esc(item) + '</span></div>';
          }).join('');
      }
      return '<div class="section-label">Конспект</div><div class="notes-box">' + esc(b.text) + '</div>';
    }).join('');

    openModal('AI-конспект готов!',
      '<div class="card" style="box-shadow:none">' +
      '<div class="row-between">' +
      '<span class="tag tag-green">Конспект</span>' +
      '<span class="tag tag-yellow">' + (analysis.stats.definitions || 0) + ' определений</span>' +
      '<span class="tag tag-yellow">' + (analysis.stats.formulas || 0) + ' формул</span>' +
      '</div>' +
      '<p class="muted" style="margin-top:8px">' + esc(note.title) + ' · ' + esc(courseName(note.courseId)) + '</p>' +
      '<div style="max-height:280px;overflow-y:auto;margin-top:8px">' + blocksHtml + '</div>' +
      '<div class="form-row" style="margin-top:12px">' +
      '<button class="btn btn-green btn-block" id="result-cards">Карточки (' + analysis.flashcards.length + ')</button>' +
      '<button class="btn btn-purple btn-block" id="result-quiz">Тест (' + analysis.quiz.length + ')</button>' +
      '</div>' +
      '<button class="btn btn-block" style="margin-top:8px" data-close-result>Готово</button>' +
      '</div>',
      function (m) {
        m.querySelector('[data-close-result]').addEventListener('click', closeModal);
        m.querySelector('#result-cards').addEventListener('click', function () {
          closeModal();
          openPractice('cards', S().state.flashcards.filter(function (f) { return f.courseId === note.courseId; }));
        });
        m.querySelector('#result-quiz').addEventListener('click', function () {
          closeModal();
          var qs = S().state.quizzes.filter(function (q) { return q.courseId === note.courseId; });
          if (qs.length) startQuiz(qs[0].id, root.querySelector('.screen') || root);
          else toast('Тестов пока нет', 'error');
        });
      });
  }

  /* ================= MATERIAL IMPORT (real files) ================= */
  function openImportMaterialModal() {
    var supportsPdf = !!window.pdfjsLib;
    var pdfHint = supportsPdf
      ? 'Поддерживаются PDF, TXT, MD и копированный текст.'
      : 'PDF.js не загрузился (нет интернета?). Для PDF вставь текст вручную.';
    openModal('Импорт материала',
      '<div class="field"><label>Курс</label><select class="select" id="imp-course">' + courseOptions() + '</select></div>' +
      '<div class="field"><label>Файл</label>' +
      '<input class="input" type="file" id="imp-file" accept=".pdf,.txt,.md,text/plain" style="padding:8px">' +
      '<p class="muted" style="margin-top:6px">' + pdfHint + '</p></div>' +
      '<div class="field"><label>Название (авто из файла)</label><input class="input" id="imp-name" placeholder="Лекции_глава2.pdf"></div>' +
      '<div class="field"><label>Вид</label><select class="select" id="imp-kind">' +
      '<option value="pdf">PDF</option><option value="ppt">Презентация</option><option value="doc">Документ</option>' +
      '</select></div>' +
      '<div class="field"><label>Текст (заполняется из файла или вручную)</label>' +
      '<textarea class="textarea" id="imp-text" placeholder="Текст из файла появится здесь..."></textarea></div>' +
      '<button class="btn btn-green btn-block" id="imp-go">Извлечь знания</button>',
      function (m) {
        var fileInput = m.querySelector('#imp-file');
        var nameInput = m.querySelector('#imp-name');
        var kindSelect = m.querySelector('#imp-kind');
        var textArea = m.querySelector('#imp-text');
        var goBtn = m.querySelector('#imp-go');

        function detectKind(fileName) {
          var n = (fileName || '').toLowerCase();
          if (n.indexOf('.ppt') > -1) return 'ppt';
          if (n.indexOf('.pdf') > -1) return 'pdf';
          return 'doc';
        }

        fileInput.addEventListener('change', function () {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          nameInput.value = file.name;
          kindSelect.value = detectKind(file.name);

          var ext = file.name.split('.').pop().toLowerCase();
          if (ext === 'txt' || ext === 'md') {
            var reader = new FileReader();
            reader.onload = function () {
              textArea.value = reader.result.slice(0, 200000);
              toast('Текст загружен из файла');
            };
            reader.readAsText(file);
            return;
          }

          if (ext === 'pdf' && window.pdfjsLib) {
            goBtn.disabled = true;
            goBtn.textContent = 'Читаю PDF...';
            var fr = new FileReader();
            fr.onload = function () {
              var data = new Uint8Array(fr.result);
              window.pdfjsLib.getDocument({ data: data }).promise.then(function (pdfDoc) {
                var pages = [];
                var promises = [];
                for (var p = 1; p <= Math.min(pdfDoc.numPages, 60); p++) {
                  promises.push(pdfDoc.getPage(p).then(function (page) {
                    return page.getTextContent().then(function (tc) {
                      return tc.items.map(function (it) { return it.str; }).join(' ');
                    });
                  }));
                }
                return Promise.all(promises).then(function (texts) {
                  textArea.value = texts.join('\n').slice(0, 200000);
                  goBtn.disabled = false;
                  goBtn.textContent = 'Извлечь знания';
                  toast('PDF: извлечено страниц ' + texts.length);
                });
              }).catch(function () {
                goBtn.disabled = false;
                goBtn.textContent = 'Извлечь знания';
                toast('Не удалось распарсить PDF. Вставь текст вручную.', 'error');
              });
            };
            fr.readAsArrayBuffer(file);
            return;
          }

          if (ext === 'pdf') {
            toast('PDF.js недоступен — вставь текст вручную', 'error');
            return;
          }

          toast('Формат не поддерживается напрямую — вставь текст вручную (или TXT/PDF)', 'error');
        });

        m.querySelector('#imp-go').addEventListener('click', function () {
          var courseId = m.querySelector('#imp-course').value;
          var fileName = m.querySelector('#imp-name').value.trim();
          var kind = m.querySelector('#imp-kind').value;
          var rawText = m.querySelector('#imp-text').value.trim();
          if (!courseId) { toast('Выбери курс', 'error'); return; }
          if (!fileName) { toast('Введи название файла', 'error'); return; }
          if (rawText.length < 40) { toast('Текст слишком короткий (мин. 40 символов)', 'error'); return; }

          var analysis = StudyAnalyzer.analyze(rawText);
          var topicNames = analysis.topics.length ? analysis.topics : analysis.keywords.slice(0, 3);
          if (topicNames.length) S().ensureTopics(courseId, topicNames);
          var topicList = S().topicScores(courseId);
          var mainTopic = topicList[0] ? topicList[0].id : null;
          if (analysis.flashcards.length) S().addFlashcards(courseId, mainTopic, analysis.flashcards);
          if (analysis.quiz.length) S().addQuiz(courseId, mainTopic, analysis.quiz);
          S().addMaterial(courseId, fileName, kind, analysis.text);
          refreshAutopilot();

          closeModal();
          toast('Материал обработан: +' + analysis.definitions.length + ' определений, +' + analysis.formulas.length + ' формул, +' + analysis.flashcards.length + ' карточек');
          go('course', courseId);
        });
      });
  }

  /* ================= COURSES ================= */
  function renderCourses() {
    var courses = S().state.courses;
    if (!courses.length) {
      return '<h1 class="title">Курсы</h1>' +
        '<div class="empty"><div class="empty-emoji">🎒</div><div class="empty-title">Пока нет курсов</div>' +
        '<div class="empty-text">Добавь свой первый курс.</div>' +
        '<button class="btn btn-primary btn-block" id="add-course">Создать курс</button></div>';
    }
    var html = '<h1 class="title">Курсы</h1><p class="subtitle">Все предметы в одном месте</p>';
    courses.forEach(function (c) {
      var knowledge = Math.round(S().courseKnowledge(c.id) * 100);
      var notesCount = S().state.notes.filter(function (n) { return n.courseId === c.id; }).length;
      var cardsCount = S().state.flashcards.filter(function (f) { return f.courseId === c.id; }).length;
      var mistakesCount = S().state.mistakes.filter(function (m) { return m.courseId === c.id; }).length;
      html += '<div class="course-card" data-course="' + c.id + '">' +
        '<div class="course-top">' +
        '<div class="course-emoji">' + c.emoji + '</div>' +
        '<span class="course-name">' + esc(c.name) + '</span>' +
        '<button class="mini-btn-sq compact" data-delete-course="' + c.id + '">Удалить</button>' +
        '</div>' +
        '<div class="course-meta">' + notesCount + ' ' + plural(notesCount, 'конспект', 'конспекта', 'конспектов') +
        ' · ' + cardsCount + ' ' + plural(cardsCount, 'карточка', 'карточки', 'карточек') +
        (mistakesCount ? ' · <span class="badge-danger" style="padding:1px 6px;border-radius:6px;font-weight:700">⚠ ' + mistakesCount + ' ' + plural(mistakesCount, 'ошибка', 'ошибки', 'ошибок') + '</span>' : '') +
        (c.examDate ? ' · экзамен ' + esc(U().formatDateRu(c.examDate)) : '') + '</div>' +
        '<div class="progress-row"><div class="progress-track" style="flex:1"><div class="progress-fill" style="width:' + knowledge + '%"></div></div>' +
        '<span class="progress-pct">' + knowledge + '%</span></div></div>';
    });
    html += '<button class="btn btn-primary btn-block" id="add-course">Добавить курс</button>';
    return html;
  }

  /* ================= COURSE DETAIL ================= */
  function renderCourseDetail() {
    var c = S().getCourse(currentCourseId);
    if (!c) return '<h1 class="title">Курс не найден</h1><button class="btn btn-block" data-nav="courses">← Назад</button>';

    var notes = S().state.notes.filter(function (n) { return n.courseId === c.id; });
    var materials = S().state.materials.filter(function (m) { return m.courseId === c.id; });
    var cards = S().state.flashcards.filter(function (f) { return f.courseId === c.id; });
    var quizzes = S().state.quizzes.filter(function (q) { return q.courseId === c.id; });
    var deadlines = S().state.deadlines.filter(function (d) { return d.courseId === c.id; });
    var mistakes = S().state.mistakes.filter(function (m) { return m.courseId === c.id; });
    var topics = S().topicScores(c.id);
    var knowledge = Math.round(S().courseKnowledge(c.id) * 100);

    var examInfo = c.examDate
      ? '<span class="tag ' + (U().daysBetween(U().todayStr(), c.examDate) <= 7 ? 'tag-red' : 'tag-blue') + '">Экзамен ' + esc(U().formatDateRu(c.examDate)) + '</span>'
      : '';

    var html = '<div class="row-between" style="margin-bottom:6px">' +
      '<button class="btn btn-sm" data-nav="courses">← Курсы</button>' + examInfo + '</div>' +
      '<h1 class="title">' + c.emoji + ' ' + esc(c.name) + '</h1>' +
      '<p class="subtitle">Уровень знаний: ' + knowledge + '%</p>' +
      '<button class="btn btn-green btn-block" data-nav="record">Записать лекцию</button>' +
      '<button class="btn btn-blue btn-block" style="margin-top:8px" data-add-deadline>Добавить дедлайн</button>';

    html += '<div class="section-label">Темы (' + topics.length + ')</div>';
    if (topics.length) {
      html += '<div class="card">' + topics.map(function (t) {
        return '<div class="row-between" style="margin-bottom:6px"><span style="font-weight:600">' + esc(t.name) + '</span>' + levelBadge(t.level) + '</div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="empty"><div class="empty-emoji">📂</div><div class="empty-title">Темы появятся после анализа</div></div>';
    }

    html += '<div class="section-label">Ошибки (' + mistakes.length + ')</div>';
    if (mistakes.length) {
      html += '<div class="card">' + mistakes.slice(0, 6).map(function (err) {
        var topicName = S().topicName(err.topicId);
        return '<div class="mistake-row">' +
          '<span>⚠</span>' +
          '<div><div class="mistake-name">' + esc(err.text) + '</div>' +
          (topicName ? '<div class="mistake-topic">Тема: ' + esc(topicName) + '</div>' : '') +
          '<div class="mistake-text">' + U().timeAgo(err.ts) + '</div></div></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="card"><p class="muted center-txt">Ошибок нет — так держать! 🎉</p></div>';
    }

    html += '<div class="section-label">Практика</div>' +
      '<div class="card">' +
      '<div class="row-between"><span>Карточки</span><span class="muted">' + cards.length + ' шт.</span><button class="btn btn-sm" data-cards="' + c.id + '">Открыть</button></div>' +
      '<div class="row-between"><span>Тесты</span><span class="muted">' + quizzes.length + ' шт.</span><button class="btn btn-sm" data-quiz-link>Открыть</button></div>' +
      '</div>';

    html += '<div class="section-label">Конспекты (' + notes.length + ')</div>';
    if (notes.length) {
      notes.forEach(function (n) {
        html += '<div class="card">' +
          '<div class="row-between"><span style="font-weight:700">' + esc(n.title) + '</span>' +
          '<button class="mini-btn-sq compact" data-delete-note="' + n.id + '">Удалить</button></div>' +
          '<p class="muted">' + U().timeAgo(n.ts) + '</p>' +
          '<div class="notes-box" style="margin-top:6px">' + esc(n.text.slice(0, 300)) + (n.text.length > 300 ? '…' : '') + '</div>' +
          '<button class="btn btn-sm btn-primary" style="margin-top:8px" data-note-full="' + n.id + '">Читать полностью</button></div>';
      });
    } else {
      html += '<div class="empty"><div class="empty-emoji">🗒️</div><div class="empty-title">Конспектов пока нет</div></div>';
    }

    html += '<div class="section-label">Материалы (' + materials.length + ')</div>';
    if (materials.length) {
      materials.forEach(function (m) {
        html += '<div class="card">' +
          '<div class="row-between"><span>' + m.emoji + ' ' + esc(m.name) + '</span>' +
          '<button class="mini-btn-sq compact" data-delete-material="' + m.id + '">Удалить</button></div>' +
          '<p class="muted">' + U().timeAgo(m.ts) + '</p>' +
          '<div class="notes-box" style="margin-top:6px">' + esc(m.text.slice(0, 250)) + (m.text.length > 250 ? '…' : '') + '</div></div>';
      });
    } else {
      html += '<div class="empty"><div class="empty-emoji">📄</div><div class="empty-title">Нет материалов</div>' +
        '<button class="btn btn-sm btn-blue" id="imp-material">Импорт</button></div>';
    }

    html += '<div class="section-label">Дедлайны (' + deadlines.length + ')</div>';
    if (deadlines.length) {
      html += '<div class="card">' + deadlines.map(function (d) {
        var da = U().daysBetween(U().todayStr(), d.date);
        var cls = da < 0 ? 'tag-red' : da <= 2 ? 'tag-red' : da <= 4 ? 'tag-yellow' : 'tag-green';
        return '<div class="row-between"><span>' + esc(d.title) + '</span>' +
          '<span class="tag ' + cls + '">' + (da < 0 ? 'просрочен' : U().formatDateRu(d.date)) + '</span></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="card"><p class="muted center-txt">Дедлайнов нет</p></div>';
    }

    return html;
  }

  /* ================= AUTOPILOT ================= */
  function renderAutopilot() {
    var plan = StudyPlanner.ensurePlan();
    var mission = StudyPlanner.todayMission(plan);
    var progress = StudyPlanner.planProgress(plan);
    var exam = StudyPlanner.nearestExamCourseName();

    var html = '<h1 class="title">Exam Autopilot</h1>' +
      '<p class="subtitle">Персональный план подготовки, который подстраивается под тебя.</p>';

    if (exam) {
      var days = U().daysBetween(U().todayStr(), exam.date);
      var urgency = days <= 3 ? 'Топим!' : days <= 7 ? 'Уже скоро' : 'Всё под контролем';
      html += '<div class="card countdown-box">' +
        '<div class="countdown-num">' + days + '</div>' +
        '<div class="countdown-label">дней до экзамена · ' + exam.emoji + ' ' + esc(exam.name) + '</div>' +
        '<div class="muted" style="margin-top:6px">' + urgency + '</div></div>';
    }

    html += '<div class="card">' +
      '<div class="row-between"><span style="font-weight:700">Прогресс плана (' + progress.done + '/' + progress.total + ')</span>' +
      '<span style="font-weight:800">' + progress.pct + '%</span></div>' +
      '<div class="progress-track" style="margin-top:8px"><div class="progress-fill" style="width:' + progress.pct + '%"></div></div></div>';

    if (mission) {
      var done = S().isPlanDayDone(mission.date, mission.topicId);
      html += '<div class="section-label">Миссия на ' + esc(U().formatDateRu(mission.date)) + '</div>' +
        '<div class="mission-card">' +
        '<div class="mission-top"><span class="mission-emoji">' + (mission.courseEmoji || '') + '</span>' +
        '<span class="mission-title">' + esc(mission.topicName) + '</span>' +
        (done ? '<span class="tag tag-green">готово</span>' : '') + '</div>' +
        '<div class="mission-topic">' + esc(mission.courseName) + '</div>' +
        '<div class="card" style="box-shadow:none;margin-bottom:10px">' +
        mission.steps.map(function (s) {
          return '<div class="row-between"><span style="font-size:13px">' + esc(s.label) + '</span><span class="muted">' + s.minutes + ' мин</span></div>';
        }).join('') +
        '<div class="divider"></div>' +
        '<div class="row-between"><span class="muted">Итого</span><span class="tag tag-yellow">' + mission.totalMinutes + ' мин</span></div>' +
        '</div>' +
        '<p class="muted" style="margin-bottom:10px">' + esc(mission.goal) + '</p>' +
        '<button class="btn btn-block ' + (done ? 'btn-green' : 'btn-primary') + '" data-plan-done="' + mission.date + '|' + mission.topicId + '|' + mission.courseId + '">' +
        (done ? 'Снять отметку' : 'Отметить выполненной') + '</button></div>';
    }

    var weak = StudyPlanner.nextTopicToStudy();
    html += '<div class="section-label">Что учить дальше</div>';
    if (weak) {
      html += '<div class="card"><div class="row-between">' +
        '<span style="font-weight:700">' + (weak.emoji || '') + ' ' + esc(weak.name) + '</span>' +
        '<span class="tag tag-red">' + U().LEVEL_LABELS[weak.level] + '</span></div>' +
        '<p class="muted" style="margin-top:6px">' + esc(weak.courseName) + '</p></div>';
    } else {
      html += '<div class="card"><p class="muted center-txt">Все темы изучены на отлично! 🎉</p></div>';
    }

    html += '<div class="section-label">План на ' + plan.days.length + ' дней</div>';
    plan.days.forEach(function (d) {
      var dayDone = S().isPlanDayDone(d.date, d.topicId);
      html += '<div class="plan-day' + (dayDone ? ' done' : '') + '">' +
        '<div class="pd-head">' +
        '<span class="pd-title">' + esc(U().formatDateRu(d.date)) + ' (' + d.dayName + ')</span>' +
        '<button class="mini-btn-sq compact" data-plan-done="' + d.date + '|' + d.topicId + '|' + d.courseId + '">' + (dayDone ? '✓ Готово' : 'Отметить') + '</button></div>' +
        '<div class="pd-topic">' + (d.courseEmoji || '') + ' ' + esc(d.topicName) + ' · ' + esc(d.courseName) + '</div>' +
        '<div class="pd-goal">' + esc(d.goal) + ' · ' + d.totalMinutes + ' мин</div></div>';
    });

    html += '<button class="btn btn-blue btn-block" id="regen-plan">Пересчитать план</button>';
    return html;
  }

  /* ================= PRACTICE (flashcards) ================= */
  function openPractice(courseId, customCards) {
    var cards = customCards || S().state.flashcards.filter(function (f) { return f.courseId === courseId; });
    if (!cards.length) {
      toast('Карточек пока нет. Добавь лекцию или импортируй материал.', 'error');
      return;
    }
    renderPracticeView(cards);
  }

  function renderPracticeView(cards) {
    var idx = 0;
    var answered = 0;

    var html =
      '<div class="row-between" style="margin-bottom:10px">' +
      '<button class="btn btn-sm" data-back>← Назад</button>' +
      '<span class="muted" id="pc-counter">1 / ' + cards.length + '</span></div>' +
      '<div class="card flashcard" id="pc-card">' +
      '<span class="fc-side-tag" id="pc-side">вопрос</span>' +
      '<div class="fc-question" id="pc-q"></div>' +
      '<div class="fc-hint">Нажми, чтобы перевернуть</div>' +
      '<div class="fc-answer hidden" id="pc-a"></div></div>' +
      '<div class="form-row" style="margin-bottom:8px">' +
      '<button class="btn btn-sm" id="pc-prev">Пред.</button>' +
      '<button class="btn btn-sm" id="pc-flip">Перевернуть</button>' +
      '<button class="btn btn-sm" id="pc-next">След.</button></div>' +
      '<div class="form-row">' +
      '<button class="btn btn-green btn-block" id="pc-rec">Знаю</button>' +
      '<button class="btn btn-danger btn-block" id="pc-forgot">Не знаю</button></div>';

    root.innerHTML = '<div class="screen">' + html + '</div>';
    var screen = root.firstChild;

    var qEl = screen.querySelector('#pc-q');
    var aEl = screen.querySelector('#pc-a');
    var sideEl = screen.querySelector('#pc-side');
    var counter = screen.querySelector('#pc-counter');
    var cardEl = screen.querySelector('#pc-card');
    var flipped = false;

    function show() {
      var card = cards[idx];
      qEl.textContent = card.question;
      aEl.textContent = card.answer;
      qEl.style.display = 'block';
      aEl.classList.add('hidden');
      sideEl.textContent = 'вопрос';
      flipped = false;
      counter.textContent = (idx + 1) + ' / ' + cards.length;
      cardEl.dataset.course = card.courseId;
    }

    function flip() {
      flipped = !flipped;
      if (flipped) {
        qEl.style.display = 'none';
        aEl.classList.remove('hidden');
        sideEl.textContent = 'ответ';
      } else {
        qEl.style.display = 'block';
        aEl.classList.add('hidden');
        sideEl.textContent = 'вопрос';
      }
    }

    cardEl.addEventListener('click', flip);
    screen.querySelector('#pc-flip').addEventListener('click', flip);
    screen.querySelector('#pc-prev').addEventListener('click', function () { idx = (idx - 1 + cards.length) % cards.length; show(); });
    screen.querySelector('#pc-next').addEventListener('click', function () { idx = (idx + 1) % cards.length; show(); });
    screen.querySelector('[data-back]').addEventListener('click', function () { go('course', cardEl.dataset.course || currentCourseId); });

    function rate(knows) {
      var card = cards[idx];
      answered++;

      if (card.topicId) {
        S().recordAnswer(card.topicId, knows ? 3 : 1);
        if (!knows) {
          S().addMistake(card.courseId, card.topicId, 'Не вспомнил карточку: ' + card.question);
        }
      }

      var isLast = idx === cards.length - 1;
      if (isLast) {
        refreshAutopilot();
        toast('Карточки пройдены! Автопилот обновлён.');
        idx = 0;
      } else {
        idx++;
      }
      show();
    }

    screen.querySelector('#pc-rec').addEventListener('click', function () { rate(true); });
    screen.querySelector('#pc-forgot').addEventListener('click', function () { rate(false); });

    show();
  }

  /* ================= QUIZ ================= */
  function startQuiz(quizId, screenEl) {
    var quiz = S().state.quizzes.find(function (q) { return q.id === quizId; });
    if (!quiz) { toast('Тест не найден', 'error'); return; }

    var qi = 0;
    var correctCount = 0;

    var html =
      '<div class="row-between" style="margin-bottom:10px">' +
      '<button class="btn btn-sm" data-quiz-back>← Назад</button>' +
      '<span class="muted">' + esc(quiz.title) + '</span></div>' +
      '<div class="section-label">Вопрос <span id="quiz-n">1</span> из ' + quiz.questions.length + '</div>' +
      '<div class="card"><div class="hero-title" id="quiz-q" style="font-size:17px"></div></div>' +
      '<div id="quiz-options"></div>' +
      '<p class="muted center-txt" id="quiz-feedback" style="margin-top:8px"></p>';

    screenEl.innerHTML = html;

    var qEl = screenEl.querySelector('#quiz-q');
    var optsEl = screenEl.querySelector('#quiz-options');
    var feedEl = screenEl.querySelector('#quiz-feedback');
    var nEl = screenEl.querySelector('#quiz-n');

    screenEl.querySelector('[data-quiz-back]').addEventListener('click', function () { go('course', quiz.courseId); });

    function showQuestion() {
      var question = quiz.questions[qi];
      nEl.textContent = qi + 1;
      qEl.textContent = question.q;
      feedEl.textContent = '';
      optsEl.innerHTML = question.options.map(function (opt, i) {
        return '<button class="quiz-option" data-opt="' + i + '">' + esc(opt) + '</button>';
      }).join('');
      $$$('.quiz-option', optsEl).forEach(function (btn) {
        btn.addEventListener('click', function () { answer(parseInt(btn.dataset.opt, 10)); });
      });
    }

    function answer(chosen) {
      var question = quiz.questions[qi];
      $$$('.quiz-option', optsEl).forEach(function (btn, i) {
        btn.disabled = true;
        if (i === question.correct) btn.classList.add('correct');
        if (i === chosen && chosen !== question.correct) btn.classList.add('wrong');
      });

      var isCorrect = chosen === question.correct;
      if (isCorrect) {
        correctCount++;
        feedEl.textContent = 'Верно!';
      } else {
        feedEl.textContent = 'Неверно. Правильный ответ подсвечен.';
        S().addMistake(quiz.courseId, quiz.topicId, 'Ошибка в тесте «' + quiz.title + '»: ' + question.q);
      }

      if (quiz.topicId) S().recordAnswer(quiz.topicId, isCorrect ? 3 : 1);

      var nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-primary btn-block';
      nextBtn.textContent = qi === quiz.questions.length - 1 ? 'Завершить' : 'Следующий';
      nextBtn.style.marginTop = '12px';
      optsEl.parentNode.appendChild(nextBtn);
      nextBtn.addEventListener('click', function () {
        nextBtn.remove();
        qi++;
        if (qi < quiz.questions.length) showQuestion();
        else finishQuiz();
      });
    }

    function finishQuiz() {
      var pct = Math.round((correctCount / quiz.questions.length) * 100);
      var msg = pct === 100 ? 'Идеально!' : pct >= 70 ? 'Отличный результат!' : pct >= 40 ? 'Хорошо, но есть слабые места' : 'Стоит повторить тему';
      refreshAutopilot();
      screenEl.innerHTML =
        '<div class="card center-txt" style="padding:26px">' +
        '<div class="empty-emoji">' + (pct >= 70 ? '🎉' : pct >= 40 ? '💪' : '📚') + '</div>' +
        '<div class="empty-title" style="font-size:20px">' + msg + '</div>' +
        '<p class="muted" style="margin:8px 0">Правильно: ' + correctCount + ' из ' + quiz.questions.length + ' (' + pct + '%)</p>' +
        '<div class="progress-track" style="max-width:200px;margin:0 auto 16px"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<p class="muted" style="margin-bottom:12px">🧠 Автопилот пересчитал твой план с учётом результата.</p>' +
        '<button class="btn btn-primary btn-block" data-quiz-retry>Пройти ещё раз</button>' +
        '<button class="btn btn-block" style="margin-top:8px" data-quiz-comeback>← Назад</button></div>';

      screenEl.querySelector('[data-quiz-retry]').addEventListener('click', function () { qi = 0; correctCount = 0; startQuiz(quiz.id, screenEl); });
      screenEl.querySelector('[data-quiz-comeback]').addEventListener('click', function () { go('course', quiz.courseId); });
    }

    showQuestion();
  }

  /* ================= GLOBAL EVENTS ================= */
  function bindGlobalEvents() {
    document.addEventListener('click', function (e) {
      var target = e.target;

      var addCourse = target.closest('#add-course');
      if (addCourse) { e.preventDefault(); openAddCourseModal(); return; }

      var addLesson = target.closest('#add-lesson');
      if (addLesson) { e.preventDefault(); openAddLessonModal(); return; }

      var addDeadline = target.closest('[data-add-deadline]');
      if (addDeadline) { e.preventDefault(); openAddDeadlineModal(); return; }

      var importMat = target.closest('#imp-material');
      if (importMat) { e.preventDefault(); openImportMaterialModal(); return; }

      var deleteCourse = target.closest('[data-delete-course]');
      if (deleteCourse) {
        e.preventDefault();
        e.stopPropagation();
        var cid = deleteCourse.dataset.deleteCourse;
        var course = S().getCourse(cid);
        confirmDialog('Удалить курс?', '«' + course.name + '» и все материалы будут удалены.', function () {
          S().deleteCourse(cid);
          toast('Курс удалён');
          render(currentView === 'course' ? 'courses' : currentView);
        });
        return;
      }

      var noteFull = target.closest('[data-note-full]');
      if (noteFull) {
        e.preventDefault();
        var note = S().state.notes.find(function (n) { return n.id === noteFull.dataset.noteFull; });
        if (note) {
          openModal(note.title,
            '<div class="notes-box" style="max-height:50vh">' + esc(note.text) + '</div>' +
            '<button class="btn btn-block" style="margin-top:12px" data-close-result>Закрыть</button>',
            function (m) { m.querySelector('[data-close-result]').addEventListener('click', closeModal); });
        }
        return;
      }

      var quizLink = target.closest('[data-quiz-link]');
      if (quizLink) {
        e.preventDefault();
        var qs = S().state.quizzes.filter(function (q) { return q.courseId === currentCourseId; });
        if (qs.length) startQuiz(qs[0].id, root.querySelector('.screen') || root);
        else toast('Тестов пока нет', 'error');
        return;
      }

      var regenPlan = target.closest('#regen-plan');
      if (regenPlan) {
        e.preventDefault();
        var freshPlan = StudyPlanner.generatePlan(14);
        S().setPlan(freshPlan);
        toast('План пересчитан');
        render('autopilot');
        return;
      }
    });

    navButtons.forEach(function (btn) {
      btn.addEventListener('click', function () { go(btn.dataset.view); });
    });

    modalRoot.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('modal-backdrop')) closeModal();
    });
  }

  /* ================= MODALS ================= */
  function openAddCourseModal() {
    openModal('Новый курс',
      '<div class="field"><label>Название</label><input class="input" id="c-name" placeholder="Например: Физика"></div>' +
      '<div class="field"><label>Эмодзи</label><input class="input" id="c-emoji" placeholder="🧪" maxlength="4"></div>' +
      '<div class="field"><label>Дата экзамена (необязательно)</label><input class="input" type="date" id="c-exam"></div>' +
      '<button class="btn btn-green btn-block" id="c-save">Создать курс</button>',
      function (m) {
        m.querySelector('#c-save').addEventListener('click', function () {
          var name = m.querySelector('#c-name').value.trim();
          if (!name) { toast('Введи название', 'error'); return; }
          var emoji = m.querySelector('#c-emoji').value.trim() || '📘';
          var examDate = m.querySelector('#c-exam').value || null;
          var created = S().addCourse(name, emoji, examDate);
          closeModal();
          toast('Курс «' + name + '» создан');
          go('course', created.id);
        });
      });
  }

  function openAddLessonModal() {
    var days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    openModal('Новая пара',
      '<div class="field"><label>Название</label><input class="input" id="l-name" placeholder="Название пары"></div>' +
      '<div class="field"><label>Курс</label><select class="select" id="l-course">' + courseOptions() + '</select></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>День</label><select class="select" id="l-day">' +
      days.map(function (d) { return '<option value="' + d + '">' + d + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Время</label><input class="input" type="time" id="l-time" value="10:00"></div></div>' +
      '<div class="field"><label>Тип</label><select class="select" id="l-type">' +
      '<option value="lecture">Лекция</option><option value="seminar">Семинар</option><option value="lab">Лабораторная</option></select></div>' +
      '<div class="field"><label>Аудитория</label><input class="input" id="l-room" placeholder="А-101"></div>' +
      '<button class="btn btn-green btn-block" id="l-save">Добавить</button>',
      function (m) {
        m.querySelector('#l-save').addEventListener('click', function () {
          var name = m.querySelector('#l-name').value.trim();
          var day = m.querySelector('#l-day').value;
          var time = m.querySelector('#l-time').value;
          if (!name) { toast('Введи название пары', 'error'); return; }
          var dayObj = S().state.schedule.find(function (d) { return d.name === day; });
          if (!dayObj) {
            dayObj = { id: 'd-' + day, dayOfWeek: days.indexOf(day), name: day, lessons: [] };
            S().state.schedule.push(dayObj);
          }
          dayObj.lessons.push({
            id: 'l-' + Date.now(),
            name: name,
            type: m.querySelector('#l-type').value,
            room: m.querySelector('#l-room').value,
            courseId: m.querySelector('#l-course').value,
            time: time,
            done: false
          });
          S().save();
          closeModal();
          toast('Пара добавлена в расписание');
          go('schedule');
        });
      });
  }

  function openAddDeadlineModal() {
    openModal('Новый дедлайн',
      '<div class="field"><label>Название</label><input class="input" id="d-title" placeholder="Лабораторная 5"></div>' +
      '<div class="field"><label>Дата</label><input class="input" type="date" id="d-date"></div>' +
      '<button class="btn btn-green btn-block" id="d-save">Добавить</button>',
      function (m) {
        m.querySelector('#d-save').addEventListener('click', function () {
          var title = m.querySelector('#d-title').value.trim();
          var date = m.querySelector('#d-date').value;
          if (!title || !date) { toast('Заполни название и дату', 'error'); return; }
          S().addDeadline(currentCourseId, title, date);
          closeModal();
          toast('Дедлайн добавлен');
          render('course');
        });
      });
  }

  /* ================= INIT ================= */
  function init() {
    S().load();
    StudyPlanner.ensurePlan();
    bindGlobalEvents();
    render('home');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

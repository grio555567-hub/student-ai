/* ===== StudyMind AI — Exam Autopilot planner =====
   Dynamic study plan: picks weak topics, schedules daily
   missions until the nearest exam, adjusts automatically
   based on knowledge levels and deadlines.
*/
(function (global) {
  'use strict';

  /* ---------- helpers ---------- */
  function todayStr() { return StudyStore.utils.todayStr(); }
  function addDays(dateStr, days) { return StudyStore.utils.addDays(dateStr, days); }
  function daysBetween(from, to) { return StudyStore.utils.daysBetween(from, to); }
  function formatDateRu(dateStr) { return StudyStore.utils.formatDateRu(dateStr); }

  const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  function dayNameRu(dateStr) {
    return DAY_NAMES[new Date(dateStr + 'T12:00:00').getDay()];
  }

  /* ---------- priority scoring ---------- */
  function topicPriority(topic, course) {
    const level = StudyStore.topicLevel(topic.id);
    let days = 30;
    if (course.examDate) days = Math.max(1, daysBetween(todayStr(), course.examDate));

    let score = 0;
    score += (4 - level) * 10;                // weak topic -> higher priority
    score += Math.max(0, (30 - days)) * 0.5;  // closer exam -> higher
    score += (topic.weight || 1) * 2;         // explicit weight (exam-heavy topics)
    return score;
  }

  /* ---------- build mission for a day ---------- */
  function buildMission(dayOffset, topic, course, planCtx) {
    const date = addDays(todayStr(), dayOffset);
    const level = StudyStore.topicLevel(topic.id);
    const cards = StudyStore.state.flashcards.filter(f => f.topicId === topic.id);
    const quizzes = StudyStore.state.quizzes.filter(q => q.topicId === topic.id);
    const notes = StudyStore.state.notes.filter(n => n.courseId === course.id);
    const materials = StudyStore.state.materials.filter(m => m.courseId === course.id);

    const steps = [];
    steps.push({ type: 'read', label: '📖 Прочитай конспект по теме «' + topic.name + '»', minutes: 15 });

    if (cards.length) {
      steps.push({ type: 'cards', label: '🔁 Повтори карточки: ' + cards.slice(0, 3).map(c => '«' + c.question.slice(0, 30) + '…»').join(', '), minutes: 10 });
    } else {
      steps.push({ type: 'cards', label: '🔁 Создай и повтори 5 карточек по теме', minutes: 10 });
    }

    if (quizzes.length) {
      steps.push({ type: 'quiz', label: '📝 Пройди тест «' + quizzes[0].title + '»', minutes: 10 });
    } else {
      steps.push({ type: 'quiz', label: '📝 Ответь на 5 вопросов для самопроверки', minutes: 10 });
    }

    if (materials.length || notes.length) {
      steps.push({ type: 'deep', label: '🔍 Разбери материал: ' + (materials[0] ? materials[0].name : notes[0].title), minutes: 15 });
    } else {
      steps.push({ type: 'deep', label: '🔍 Составь краткую шпаргалку по теме', minutes: 15 });
    }

    const totalMinutes = steps.reduce((acc, s) => acc + s.minutes, 0);
    const goal = level < 2
      ? 'Цель: разобраться в теме «' + topic.name + '». После — уровень знаний вырастет.'
      : 'Цель: закрепить «' + topic.name + '» до уверенного уровня.';

    return {
      date,
      dayName: dayNameRu(date),
      courseId: course.id,
      topicId: topic.id,
      topicName: topic.name,
      courseName: course.name,
      courseEmoji: course.emoji,
      title: course.emoji + ' ' + topic.name,
      steps,
      totalMinutes,
      goal
    };
  }

  /* ---------- generate full plan ---------- */
  function generatePlan(daysAhead) {
    const state = StudyStore.state;
    const today = todayStr();
    const horizon = daysAhead || 14;

    // gather all topics with priority
    const pool = [];
    state.courses.forEach(course => {
      (state.topics[course.id] || []).forEach(topic => {
        if (StudyStore.topicLevel(topic.id) >= 4) return; // mastered
        pool.push({ topic, course, priority: topicPriority(topic, course) });
      });
    });
    pool.sort((a, b) => b.priority - a.priority);

    if (!pool.length) {
      const firstCourse = state.courses[0];
      if (firstCourse) {
        const topic = { id: 't-new', name: 'Основы курса' };
        if (!(state.topics[firstCourse.id] || []).some(t => t.id === 't-new')) {
          (state.topics[firstCourse.id] = state.topics[firstCourse.id] || []).push(topic);
        }
        pool.push({ topic, course: firstCourse, priority: 100 });
      }
    }

    // plan days: earliest exam first, spread topics
    const days = [];
    for (let offset = 0; offset < horizon; offset++) {
      days.push(addDays(today, offset));
    }

    // sort days by urgency: exams & deadlines soon -> first
    const dayWeight = days.map(date => {
      let w = 0;
      state.courses.forEach(c => {
        if (c.examDate === date) w += 50;
      });
      state.deadlines.forEach(d => {
        if (d.date === date) w += 30;
      });
      return { date, w };
    });

    const sortedDays = dayWeight.slice().sort((a, b) => b.w - a.w);

    // fresh learning first (level 0-1), then reinforcement
    const fresh = pool.filter(p => StudyStore.topicLevel(p.topic.id) < 2);
    const reinforcement = pool.filter(p => StudyStore.topicLevel(p.topic.id) >= 2);
    const orderedPool = fresh.concat(reinforcement);

    const planDays = [];
    let poolIdx = 0;
    const usedTopics = new Set();

    for (let i = 0; i < Math.min(horizon, Math.max(pool.length, 3)); i++) {
      // pick next topic, cycle if exhausted
      let entry = null;
      for (let attempt = 0; attempt < orderedPool.length; attempt++) {
        const candidate = orderedPool[(poolIdx + attempt) % orderedPool.length];
        if (!usedTopics.has(candidate.topic.id)) {
          entry = candidate;
          poolIdx = (poolIdx + attempt + 1) % orderedPool.length;
          break;
        }
      }
      if (!entry) {
        // all used: restart with weakest first
        orderedPool.forEach(p => { if (usedTopics.has(p.topic.id)) usedTopics.delete(p.topic.id); });
        entry = orderedPool[poolIdx % orderedPool.length];
        poolIdx++;
      }
      usedTopics.add(entry.topic.id);
      planDays.push(buildMission(i, entry.topic, entry.course, {}));
    }

    return {
      generatedAt: Date.now(),
      generatedFor: today,
      examDate: nearestExamDate(),
      examCourse: nearestExamCourseName(),
      days: planDays,
      daysAhead: horizon
    };
  }

  function nearestExamDate() {
    const state = StudyStore.state;
    const exams = state.courses.filter(c => c.examDate).map(c => c.examDate).sort();
    return exams[0] || null;
  }

  function nearestExamCourseName() {
    const state = StudyStore.state;
    const today = todayStr();
    let best = null;
    state.courses.forEach(c => {
      if (!c.examDate) return;
      const d = daysBetween(today, c.examDate);
      if (d < 0) return;
      if (!best || d < best.days) best = { name: c.name, emoji: c.emoji, date: c.examDate, days: d };
    });
    return best;
  }

  /* ---------- ensure plan is fresh ---------- */
  function ensurePlan() {
    let plan = StudyStore.getPlan();
    const today = todayStr();

    if (!plan || plan.generatedFor !== today || !plan.days || !plan.days.length) {
      plan = generatePlan(14);
      StudyStore.setPlan(plan);
    }
    return plan;
  }

  /* ---------- today's mission ---------- */
  function todayMission(plan) {
    if (!plan || !plan.days) return null;
    const today = todayStr();
    const found = plan.days.find(d => d.date === today);
    return found || plan.days[0] || null;
  }

  /* ---------- plan progress ---------- */
  function planProgress(plan) {
    if (!plan || !plan.days || !plan.days.length) return { done: 0, total: 0, pct: 0 };
    const done = plan.days.filter(d => StudyStore.isPlanDayDone(d.date, d.topicId)).length;
    return { done, total: plan.days.length, pct: Math.round((done / plan.days.length) * 100) };
  }

  /* ---------- next weak topic to study ---------- */
  function nextTopicToStudy() {
    const weak = StudyStore.weakTopics(10);
    return weak[0] || null;
  }

  global.StudyPlanner = {
    generatePlan,
    ensurePlan,
    todayMission,
    planProgress,
    nextTopicToStudy,
    nearestExamDate,
    nearestExamCourseName,
    topicPriority
  };
})(window);

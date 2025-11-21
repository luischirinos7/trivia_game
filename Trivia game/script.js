// ----------------- UTILIDADES -----------------
function decodeHtmlEntities(input) {
    const txt = document.createElement('textarea');
    txt.innerHTML = input || '';
    return txt.value;
}
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ----------------- ESTADO GLOBAL -----------------
const state = {
    config: null,
    questions: [],
    currentIndex: 0,
    score: 0,
    correctCount: 0,
    incorrectCount: 0,
    timerInterval: null,
    timeLeft: 20,
    questionStartTimestamp: null,
    times: [],
    paused: false,
    translateCache: new Map(),
    translateFailures: 0
};

// ----------------- ELEMENTOS DOM -----------------
const configCard = document.getElementById('configCard');
const gameCard = document.getElementById('gameCard');
const resultsCard = document.getElementById('resultsCard');

const configForm = document.getElementById('configForm');
const startBtn = document.getElementById('startBtn');

const loadingArea = document.getElementById('loadingArea');
const loadingText = document.getElementById('loadingText');

const questionArea = document.getElementById('questionArea');
const questionText = document.getElementById('questionText');
const optionsEl = document.getElementById('options');
const progressText = document.getElementById('progressText');
const playerInfo = document.getElementById('playerInfo');
const timerEl = document.getElementById('timer');
const scoreDisplay = document.getElementById('scoreDisplay');

const translateToggle = document.getElementById('translateToggle');
const translateNotice = document.getElementById('translateNotice');

const resName = document.getElementById('resName');
const resScore = document.getElementById('resScore');
const resCorrect = document.getElementById('resCorrect');
const resPercent = document.getElementById('resPercent');
const resTimeTotal = document.getElementById('resTimeTotal');
const resTimeAvg = document.getElementById('resTimeAvg');

const restartSame = document.getElementById('restartSame');
const restartConfig = document.getElementById('restartConfig');
const finishBtn = document.getElementById('finishBtn');

const nameInput = document.getElementById('playerName');
const countInput = document.getElementById('questionCount');
const diffInput = document.getElementById('difficulty');
const catInput = document.getElementById('category');

const nameError = document.getElementById('nameError');
const countError = document.getElementById('countError');

// ----------------- EVENTOS -----------------
configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    startGameFromForm();
});

restartSame.addEventListener('click', () => {
    if (!state.config) return;
    resetStateForNewGame();
    startGame(state.config);
});

restartConfig.addEventListener('click', () => {
    resetAll();
    showCard('config');
});

finishBtn.addEventListener('click', () => {
    resetAll();
    alert('Partida finalizada. Podés cerrar la ventana o iniciar otra partida.');
    showCard('config');
});

// ----------------- LÓGICA DE NAVEGACIÓN -----------------
function showCard(which) {
    configCard.classList.toggle('hide', which !== 'config');
    gameCard.classList.toggle('hide', which !== 'game');
    resultsCard.classList.toggle('hide', which !== 'results');
}

function validateForm() {
    const name = nameInput.value.trim();
    const count = Number(countInput.value);
    let ok = true;

    nameError.style.display = (name.length < 2 || name.length > 20) ? 'block' : 'none';
    countError.style.display = (!Number.isInteger(count) || count < 5 || count > 20) ? 'block' : 'none';

    if (nameError.style.display === 'block') ok = false;
    if (countError.style.display === 'block') ok = false;

    return ok;
}

async function startGameFromForm() {
    if (!validateForm()) return;

    const cfg = {
        playerName: nameInput.value.trim(),
        amount: Number(countInput.value),
        difficulty: diffInput.value,
        category: catInput.value,
        translate: translateToggle.checked
    };

    state.config = cfg;
    resetStateForNewGame();
    await startGame(cfg);
}

function resetStateForNewGame() {
    state.questions = [];
    state.currentIndex = 0;
    state.score = 0;
    state.correctCount = 0;
    state.incorrectCount = 0;
    state.times = [];
    state.paused = false;

    clearInterval(state.timerInterval);
    state.timerInterval = null;

    state.translateFailures = 0;
}

function resetAll() {
    resetStateForNewGame();
    state.config = null;

    nameInput.value = '';
    countInput.value = 5;
    diffInput.value = '';
    catInput.value = '';

    nameError.style.display = 'none';
    countError.style.display = 'none';

    updateScoreDisplay();
    showCard('config');
}

// ----------------- CONSTRUCCIÓN URL OpenTDB -----------------
function buildOpenTdbUrl(cfg) {
    const base = 'https://opentdb.com/api.php';
    const params = new URLSearchParams();

    params.set('amount', String(cfg.amount));
    if (cfg.difficulty) params.set('difficulty', cfg.difficulty);
    if (cfg.category) params.set('category', cfg.category);

    return base + '?' + params.toString();
}

// ----------------- TRADUCCIÓN -----------------
async function translateOneText(text) {
    if (!text) return text;
    if (state.translateCache.has(text)) return state.translateCache.get(text);

    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`;
        const res = await fetch(url);
        const data = await res.json();

        if (data?.responseData?.translatedText) {
            const translated = data.responseData.translatedText;
            state.translateCache.set(text, translated);
            return translated;
        }

        return text;
    } catch (e) {
        console.warn("Error traduciendo:", text, e);
        return text;
    }
}

async function translateBatch(textsArray) {
    try {
        return await Promise.all(textsArray.map(txt => translateOneText(txt)));
    } catch {
        state.translateFailures++;
        return textsArray;
    }
}

// ----------------- INICIO DEL JUEGO -----------------
async function startGame(cfg) {
    showCard('game');
    playerInfo.textContent = `Jugador: ${cfg.playerName}`;
    progressText.textContent = `Preparando…`;

    loadingArea.classList.remove('hide');
    questionArea.classList.add('hide');
    loadingText.textContent = 'Cargando preguntas desde OpenTDB…';
    translateNotice.classList.add('hide');

    updateScoreDisplay();

    try {
        const resp = await fetch(buildOpenTdbUrl(cfg));
        const data = await resp.json();

        if (!resp.ok || data.response_code !== 0)
            throw new Error('Error al obtener preguntas.');

        const rawQuestions = data.results.map(q => ({
            question: decodeHtmlEntities(q.question),
            correct_answer: decodeHtmlEntities(q.correct_answer),
            incorrect_answers: q.incorrect_answers.map(a => decodeHtmlEntities(a)),
            type: q.type,
            difficulty: q.difficulty
        }));

        if (cfg.translate) {
            const translated = [];

            for (let i = 0; i < rawQuestions.length; i++) {
                loadingText.textContent = `Traduciendo pregunta ${i + 1} de ${rawQuestions.length}…`;

                const rq = rawQuestions[i];
                const batch = [rq.question, rq.correct_answer, ...rq.incorrect_answers];
                const translatedArr = await translateBatch(batch);

                translated.push({
                    question: translatedArr[0],
                    correct_answer: translatedArr[1],
                    incorrect_answers: translatedArr.slice(2),
                    type: rq.type,
                    difficulty: rq.difficulty
                });
            }

            state.questions = translated;
        } else {
            state.questions = rawQuestions;
        }

        loadingArea.classList.add('hide');
        questionArea.classList.remove('hide');

        state.currentIndex = 0;
        renderCurrentQuestion();

    } catch (err) {
        loadingText.textContent = 'Error: ' + err.message;

        loadingArea.innerHTML = `
            <div style="text-align:center">
                <p class="small" style="color:var(--danger)">Hubo un error cargando o traduciendo.</p>
                <div style="margin-top:8px">
                    <button id="backBtn" class="btn secondary">Volver</button>
                </div>
            </div>`;

        document.getElementById('backBtn').addEventListener('click', () => {
            resetAll();
            loadingArea.innerHTML = '';
            loadingArea.appendChild(loadingText);
        });
    }
}

// ----------------- PREGUNTAS -----------------
function renderCurrentQuestion() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;

    state.timeLeft = 20;
    updateTimerDisplay();
    translateNotice.classList.add('hide');

    const q = state.questions[state.currentIndex];

    progressText.textContent = `Pregunta ${state.currentIndex + 1} de ${state.questions.length}`;
    questionText.textContent = q.question;

    const opciones = shuffle([q.correct_answer, ...q.incorrect_answers]);

    optionsEl.innerHTML = '';
    opciones.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt;

        btn.addEventListener('click', () => handleAnswer(opt, btn));
        optionsEl.appendChild(btn);
    });

    updateScoreDisplay();
    startTimer();
    state.questionStartTimestamp = Date.now();
}

// ----------------- PUNTUACIÓN Y TIMER -----------------
function updateScoreDisplay() {
    scoreDisplay.textContent =
        `Puntuación: ${state.score} | Correctas: ${state.correctCount} | Incorrectas: ${state.incorrectCount}`;
}

function startTimer() {
    clearInterval(state.timerInterval);
    state.paused = false;

    updateTimerDisplay();

    state.timerInterval = setInterval(() => {
        if (state.paused) return;

        state.timeLeft--;
        updateTimerDisplay();

        if (state.timeLeft <= 0) {
            clearInterval(state.timerInterval);
            state.timerInterval = null;
            handleTimeout();
        }
    }, 1000);
}

function updateTimerDisplay() {
    timerEl.textContent = `${state.timeLeft} s`;

    if (state.timeLeft <= 5) timerEl.classList.add('warning');
    else timerEl.classList.remove('warning');
}

// ----------------- MANEJO DE RESPUESTAS -----------------
function handleAnswer(selected, btn) {
    state.paused = true;
    clearInterval(state.timerInterval);

    const allBtns = optionsEl.querySelectorAll('button');
    allBtns.forEach(b => b.disabled = true);

    const q = state.questions[state.currentIndex];
    const correct = q.correct_answer;

    const elapsed = Math.round((Date.now() - state.questionStartTimestamp) / 1000);
    state.times.push(elapsed);

    if (selected === correct) {
        btn.classList.add('correct');
        state.score += 10;
        state.correctCount++;
    } else {
        btn.classList.add('incorrect');
        state.incorrectCount++;

        allBtns.forEach(b => {
            if (b.innerText === correct) b.classList.add('correct');
        });
    }

    updateScoreDisplay();
    setTimeout(() => goToNextQuestion(), 1500);
}

function handleTimeout() {
    state.times.push(20);
    state.incorrectCount++;

    const q = state.questions[state.currentIndex];
    const correct = q.correct_answer;

    const allBtns = optionsEl.querySelectorAll('button');
    allBtns.forEach(b => {
        b.disabled = true;
        if (b.innerText === correct) b.classList.add('correct');
    });

    updateScoreDisplay();
    setTimeout(() => goToNextQuestion(), 1500);
}

// ----------------- NAVEGACIÓN ENTRE PREGUNTAS -----------------
function goToNextQuestion() {
    if (state.currentIndex >= state.questions.length - 1) {
        finishGame();
    } else {
        state.currentIndex++;
        renderCurrentQuestion();
    }
}

function finishGame() {
    clearInterval(state.timerInterval);

    const total = state.questions.length;
    const correct = state.correctCount;
    const score = state.score;

    const sumTime = state.times.reduce((a, b) => a + b, 0);
    const avgTime = total ? (sumTime / total) : 0;
    const percent = total ? Math.round((correct / total) * 100) : 0;

    resName.textContent = state.config.playerName;
    resScore.textContent = score;
    resCorrect.textContent = `${correct} / ${total}`;
    resPercent.textContent = `${percent}%`;
    resTimeTotal.textContent = `${sumTime} s`;
    resTimeAvg.textContent = `${avgTime.toFixed(2)} s`;

    showCard('results');
}

// ----------------- INICIO -----------------
showCard('config');

// ----------------- PREVENIR CIERRE ACCIDENTAL -----------------
window.addEventListener('beforeunload', (e) => {
    if (gameCard && !gameCard.classList.contains('hide')) {
        e.preventDefault();
        e.returnValue = '';
    }
});
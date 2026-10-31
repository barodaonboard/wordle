const guessGrid = document.querySelector('[data-guess-grid]');
const alertContainer = document.querySelector('[data-alert-container]');
const keyboard = document.querySelector('[data-keyboard]');

const FLIP_ANIMATION_DURATION = 500;
const DANCE_ANIMATION_DURATION = 500;
const START_DATE = new Date("2026-10-31T00:00:00+05:30"); // Epoch time for puzzle starting day

function getAbsoluteDayIndex(timeMs) {
  return Math.floor((timeMs - START_DATE.getTime()) / 86400000);
}

function getLocalStateKey() {
  const urlParams = new URLSearchParams(window.location.search);
  const offset = parseInt(urlParams.get('offset')) || 0;
  const daysPassed = getAbsoluteDayIndex(Date.now());
  return `bpgc_wordle_v9_${Math.max(0, daysPassed - offset)}`;
}

let targetWords = [];
let targetHints = [];
let dictionary = [];
let targetWord = '';
let currentHint = '';
let wordLength = 0;
let tries = 6;
let isInteracting = false;
let gameStartTime = null;
let gameElapsedMs = 0;
let liveTimerInterval = null;
let hintUsed = false;

async function fetchWords() {
  try {
    const targetResponse = await fetch('targetwords.txt', { cache: 'no-cache' });
    const targetText = await targetResponse.text();
    const targetLines = targetText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    targetWords = [];
    targetHints = [];
    targetLines.forEach(line => {
      const [word, ...hintParts] = line.split(',');
      const w = word.trim().toLowerCase();
      if (w.length >= 5 && w.length <= 7) {
        targetWords.push(w);
        targetHints.push(hintParts.join(',').trim() || '');
      }
    });

    const dictResponse = await fetch('dictionary.txt', { cache: 'no-cache' });
    const dictText = await dictResponse.text();
    dictionary = dictText.split('\n').map(word => word.trim().toLowerCase()).filter(w => w.length > 0);

    startGame();
  } catch (error) {
    showAlert("Failed to load words");
    console.error(error);
  }
}

function getTargetWordIndex() {
  const urlParams = new URLSearchParams(window.location.search);
  const offset = parseInt(urlParams.get('offset')) || 0;
  const daysPassed = getAbsoluteDayIndex(Date.now());
  return Math.max(0, daysPassed - offset) % targetWords.length;
}


function startGame() {
  if (targetWords.length === 0) {
    showAlert('Please save some valid words in targetwords.txt first!', 10000);
    return;
  }

  const wordIndex = getTargetWordIndex();
  targetWord = targetWords[wordIndex];
  currentHint = targetHints[wordIndex] || '';
  wordLength = targetWord.length;
  hintUsed = false;

  // Setup hint button
  const hintBtn = document.getElementById('hint-btn');
  const hintDisplay = document.getElementById('hint-display');
  if (hintBtn) {
    hintBtn.classList.remove('used');
    hintBtn.disabled = true;
    hintBtn.textContent = '💡 Hint (after 2 guesses)';
    hintBtn.onclick = useHint;
  }
  if (hintDisplay) {
    hintDisplay.textContent = '';
    hintDisplay.classList.add('hide');
  }
  document.documentElement.style.setProperty('--word-length', wordLength);

  // Clear grid and render standard
  guessGrid.innerHTML = '';
  const totalTiles = wordLength * tries;
  for (let i = 0; i < totalTiles; i++) {
    const tile = document.createElement('div');
    tile.classList.add('tile');
    guessGrid.appendChild(tile);
  }

  isInteracting = true;
  gameStartTime = null;
  gameElapsedMs = 0;
  if (liveTimerInterval) clearInterval(liveTimerInterval);
  liveTimerInterval = null;
  const liveTimerValue = document.getElementById('live-timer-value');
  if (liveTimerValue) liveTimerValue.textContent = '0:00';

  // Handle past puzzle indicator
  const urlParams = new URLSearchParams(window.location.search);
  const offset = parseInt(urlParams.get('offset')) || 0;

  // Update days remaining countdown (hide for past puzzles)
  const currentIndex = getTargetWordIndex();
  const daysRemaining = targetWords.length - currentIndex - 1;
  const daysEl = document.querySelector('[data-days-remaining]');
  if (daysEl) {
    if (offset > 0) {
      daysEl.parentElement.style.display = 'none';
    } else {
      daysEl.parentElement.style.display = '';
      if (daysRemaining > 0) {
        daysEl.textContent = `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} to go!!`;
      } else {
        daysEl.textContent = `Last wordle!!`;
      }
    }
  }
  const indicator = document.getElementById('past-puzzle-indicator');
  const dateSpan = document.getElementById('past-puzzle-date');

  if (offset > 0) {
    const targetMs = Date.now() - offset * 86400000;
    const dateString = new Date(targetMs).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long' });
    dateSpan.textContent = dateString;
    indicator.classList.remove('hide');
  } else {
    indicator.classList.add('hide');
  }

  // Reset keyboard colors before loading state
  document.querySelectorAll('.key').forEach(k => delete k.dataset.state);

  setupModals();

  if (!loadGameState()) {
    startInteraction();
    const infoModal = document.getElementById('info-modal');
    if (infoModal) infoModal.classList.remove('hide');
  }
}

function saveGameState(status = 'IN_PROGRESS') {
  const guessRows = [];
  const tiles = Array.from(guessGrid.querySelectorAll('.tile'));
  for (let r = 0; r < tries; r++) {
    const row = tiles.slice(r * wordLength, (r + 1) * wordLength);
    const hasState = row.some(t => t.dataset.state && t.dataset.state !== 'active');
    if (!hasState) break;
    const guess = row.map(t => t.dataset.letter).join('');
    guessRows.push(guess);
  }

  const state = {
    guesses: guessRows,
    hintUsed: hintUsed,
    gameStartTime: gameStartTime,
    gameElapsedMs: gameElapsedMs,
    status: status
  };

  localStorage.setItem(getLocalStateKey(), JSON.stringify(state));
}

function loadGameState() {
  const savedState = localStorage.getItem(getLocalStateKey());
  if (!savedState) return false;

  try {
    const state = JSON.parse(savedState);
    if (!state || (!state.guesses || state.guesses.length === 0) && !state.hintUsed) return false;

    if (state.hintUsed) {
      hintUsed = true;
      const hintBtn = document.getElementById('hint-btn');
      if (hintBtn) {
        hintBtn.classList.add('used');
        hintBtn.disabled = true;
        hintBtn.textContent = '💡 Hint Used (-150 pts)';
      }
      const hintDisplay = document.getElementById('hint-display');
      if (hintDisplay && currentHint) {
        hintDisplay.textContent = currentHint;
        hintDisplay.classList.remove('hide');
      }
    } else {
      const attempts = state.guesses ? state.guesses.length : 0;
      const hintBtn = document.getElementById('hint-btn');
      if (hintBtn) {
        if (attempts >= 2) {
          hintBtn.disabled = false;
          hintBtn.textContent = '💡 Hint (-150 pts)';
        } else {
          hintBtn.disabled = true;
          hintBtn.textContent = `💡 Hint (after ${2 - attempts} guess${2 - attempts > 1 ? 'es' : ''})`;
        }
      }
    }

    gameStartTime = state.gameStartTime;
    gameElapsedMs = state.gameElapsedMs || 0;

    state.guesses.forEach(guess => {
      const unusedTiles = getUnusedTiles();
      for (let i = 0; i < wordLength; i++) {
        unusedTiles[i].dataset.state = 'active';
        unusedTiles[i].dataset.letter = guess[i];
        unusedTiles[i].textContent = guess[i].toUpperCase();
      }
      const activeTiles = [...getActiveTiles()];

      const targetLetterObj = targetWord.split('').reduce((obj, letter) => {
        obj[letter] = (obj[letter] || 0) + 1;
        return obj;
      }, {});

      const guessLetters = guess.split('');
      const evaluatedStates = new Array(wordLength).fill('wrong');
      guessLetters.forEach((letter, i) => {
        if (targetWord[i] === letter) {
          evaluatedStates[i] = 'correct';
          targetLetterObj[letter] -= 1;
        }
      });
      guessLetters.forEach((letter, i) => {
        if (evaluatedStates[i] === 'wrong' && targetLetterObj[letter] > 0) {
          evaluatedStates[i] = 'wrong-location';
          targetLetterObj[letter] -= 1;
        }
      });

      activeTiles.forEach((tile, index) => {
        const letter = tile.dataset.letter;
        tile.dataset.state = evaluatedStates[index];
        const keyBtn = document.querySelector(`[data-key="${letter.toUpperCase()}"]`) || document.querySelector(`[data-key="${letter}"]`);
        if (keyBtn) {
          const currentState = keyBtn.dataset.state;
          const newState = evaluatedStates[index];
          if (currentState !== 'correct') {
            if (newState === 'correct') {
              keyBtn.dataset.state = newState;
            } else if (currentState !== 'wrong-location') {
              keyBtn.dataset.state = newState;
            }
          }
        }
      });
    });

    if (state.status === 'WON' || state.status === 'LOST') {
      stopInteraction();
      disableHintButton();
      showTimer(state.status === 'WON');
    } else {
      if (state.gameStartTime) {
        startLiveTimer();
      }
      startInteraction();
    }

    return true;
  } catch (e) {
    console.error("Error loading state", e);
    return false;
  }
}

function setupModals() {
  const infoModalBtn = document.getElementById('info-modal-btn');
  const infoModal = document.getElementById('info-modal');
  const closeInfo = document.getElementById('close-info');
  const startGameBtn = document.getElementById('start-game-btn');

  if (infoModalBtn && infoModal && closeInfo) {
    infoModalBtn.onclick = () => infoModal.classList.remove('hide');
    closeInfo.onclick = () => infoModal.classList.add('hide');
    if (startGameBtn) startGameBtn.onclick = () => infoModal.classList.add('hide');
    infoModal.addEventListener('click', (event) => {
      if (event.target === infoModal) {
        infoModal.classList.add('hide');
      }
    });
  }

  const endgameArchiveBtn = document.getElementById('endgame-archive-btn');
  const archiveModal = document.getElementById('archive-modal');
  const closeArchive = document.getElementById('close-archive');
  const archiveList = document.getElementById('archive-list');

  if (archiveModal && closeArchive && archiveList) {
    const openArchive = () => {
      populateArchiveList();
      archiveModal.classList.remove('hide');
    };
    if (endgameArchiveBtn) endgameArchiveBtn.onclick = openArchive;
    closeArchive.onclick = () => archiveModal.classList.add('hide');
    archiveModal.addEventListener('click', (event) => {
      if (event.target === archiveModal) archiveModal.classList.add('hide');
    });
  }
}


function populateArchiveList() {
  const archiveList = document.getElementById('archive-list');
  archiveList.innerHTML = '';

  const nowMs = Date.now();

  // Number of days since the launch date
  const daysSinceLaunch = getAbsoluteDayIndex(nowMs);

  // Show only dates from launch day onwards
  const totalDays = Math.max(0, daysSinceLaunch) + 1;

  for (let i = 0; i < totalDays; i++) {
    const targetMs = nowMs - i * 86400000;
    const isToday = i === 0;

    const dateText = new Date(targetMs).toLocaleDateString(
      'en-IN',
      {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'long'
      }
    );

    const dayLabel = isToday
      ? 'Today'
      : (i === 1 ? 'Yesterday' : `${i} days ago`);

    const item = document.createElement('a');
    item.href = isToday ? '.' : `?offset=${i}`;
    item.className = 'archive-item';

    item.innerHTML = `
      <span class="date-text">${dateText}</span>
      <span class="day-label">${dayLabel}</span>
    `;

    archiveList.appendChild(item);
  }
}



function startInteraction() {
  document.addEventListener('keydown', handleKeyPress);
  document.addEventListener('click', handleMouseClick);
}

function stopInteraction() {
  document.removeEventListener('keydown', handleKeyPress);
  document.removeEventListener('click', handleMouseClick);
}

function handleMouseClick(e) {
  if (e.target.matches('[data-key]')) {
    pressKey(e.target.dataset.key);
    return;
  }
  if (e.target.matches('[data-enter]')) {
    submitGuess();
    return;
  }
  if (e.target.matches('[data-delete]')) {
    deleteKey();
    return;
  }
  if (e.target.closest('[data-delete]')) {
    deleteKey();
    return;
  }
}

function handleKeyPress(e) {
  if (e.key === 'Enter') {
    submitGuess();
    return;
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    deleteKey();
    return;
  }
  if (e.key.match(/^[a-z]$/i)) {
    pressKey(e.key);
    return;
  }
}

function pressKey(key) {
  const activeTiles = getActiveTiles();
  if (activeTiles.length >= wordLength) return;

  const unusedTiles = getUnusedTiles();
  if (unusedTiles.length === 0) return;

  const nextTile = unusedTiles[0];
  nextTile.dataset.state = 'active';
  nextTile.dataset.letter = key.toLowerCase();
  nextTile.textContent = key;
}

function deleteKey() {
  const activeTiles = getActiveTiles();
  if (activeTiles.length === 0) return;
  const lastTile = activeTiles[activeTiles.length - 1];
  lastTile.textContent = '';
  delete lastTile.dataset.state;
  delete lastTile.dataset.letter;
}

function submitGuess() {
  const activeTiles = [...getActiveTiles()];
  if (activeTiles.length !== wordLength) {
    showAlert('Not enough letters');
    shakeTiles(activeTiles);
    return;
  }

  const guess = activeTiles.map(tile => tile.dataset.letter).join('');

  // Check against dictionary or target words
  if (!dictionary.includes(guess) && !targetWords.includes(guess)) {
    showAlert('Not in word list');
    shakeTiles(activeTiles);
    return;
  }

  // Start the solve timer on first valid submission
  if (!gameStartTime) {
    gameStartTime = Date.now();
    startLiveTimer();
  }

  stopInteraction();

  // Create object mapping letter to frequency in target word
  const targetLetterObj = targetWord.split('').reduce((obj, letter) => {
    obj[letter] = (obj[letter] || 0) + 1;
    return obj;
  }, {});

  const guessLetters = activeTiles.map(tile => tile.dataset.letter);

  // First pass: mark correct positions
  const evaluatedStates = new Array(wordLength).fill('wrong');
  guessLetters.forEach((letter, i) => {
    if (targetWord[i] === letter) {
      evaluatedStates[i] = 'correct';
      targetLetterObj[letter] -= 1;
    }
  });

  // Second pass: mark wrong-locations
  guessLetters.forEach((letter, i) => {
    if (evaluatedStates[i] === 'wrong' && targetLetterObj[letter] > 0) {
      evaluatedStates[i] = 'wrong-location';
      targetLetterObj[letter] -= 1;
    }
  });

  // Reveal animations
  activeTiles.forEach((...params) => flipTile(...params, guess, evaluatedStates));
}

function flipTile(tile, index, array, guess, evaluatedStates) {
  setTimeout(() => {
    tile.classList.add('flip');
  }, (index * FLIP_ANIMATION_DURATION) / 2);

  tile.addEventListener('transitionend', () => {
    tile.classList.remove('flip');
    const letter = tile.dataset.letter;

    tile.dataset.state = evaluatedStates[index];

    // Update keyboard color
    const keyBtn = document.querySelector(`[data-key="${letter.toUpperCase()}"]`) || document.querySelector(`[data-key="${letter}"]`);
    if (keyBtn) {
      const currentState = keyBtn.dataset.state;
      const newState = evaluatedStates[index];

      if (currentState === 'correct') {
        // Correct should never be downgraded
      } else if (newState === 'correct') {
        keyBtn.dataset.state = newState;
      } else if (currentState !== 'wrong-location') {
        // Only set if not already wrong-location (don't downgrade to wrong)
        keyBtn.dataset.state = newState;
      }
    }

    if (index === array.length - 1) {
      tile.addEventListener('transitionend', () => {
        startInteraction();
        updateHintButtonState();
        checkWinLose(guess, array);
      }, { once: true });
    }
  }, { once: true });
}

function getActiveTiles() {
  return Array.from(guessGrid.querySelectorAll('.tile')).filter(tile => tile.hasAttribute('data-state') && tile.dataset.state === 'active');
}

function getUnusedTiles() {
  return Array.from(guessGrid.querySelectorAll('.tile:not([data-letter])'));
}

function showAlert(message, duration = 1000) {
  const alert = document.createElement('div');
  alert.textContent = message;
  alert.classList.add('alert');

  alertContainer.prepend(alert);
  if (duration == null) return;

  setTimeout(() => {
    alert.classList.add('hide');
    alert.addEventListener('transitionend', () => alert.remove());
  }, duration);
}

function shakeTiles(tiles) {
  tiles.forEach(tile => {
    tile.classList.add('shake');
    tile.addEventListener('animationend', () => tile.classList.remove('shake'), { once: true });
  });
}

function checkWinLose(guess, tiles) {
  const remainingTiles = getUnusedTiles();
  const attempts = tries - (remainingTiles.length / wordLength);

  if (guess === targetWord) {
    gameElapsedMs = Date.now() - (gameStartTime || Date.now());
    stopLiveTimer();
    disableHintButton();
    saveGameState('WON');
    


    showAlert('You Win!', 5000);
    stopInteraction();
    setTimeout(() => showTimer(true), 1500);
    return;
  }

  if (remainingTiles.length === 0) {
    gameElapsedMs = Date.now() - (gameStartTime || Date.now());
    stopLiveTimer();
    disableHintButton();
    saveGameState('LOST');



    showAlert(targetWord.toUpperCase(), null);
    stopInteraction();
    setTimeout(() => showTimer(false), 1500);
    return;
  }

  saveGameState('IN_PROGRESS');
}

function updateHintButtonState() {
  if (hintUsed) return;
  const tiles = Array.from(guessGrid.querySelectorAll('.tile'));
  let attempts = 0;
  for (let r = 0; r < tries; r++) {
    const row = tiles.slice(r * wordLength, (r + 1) * wordLength);
    const hasState = row.some(t => t.dataset.state && t.dataset.state !== 'active');
    if (hasState) attempts++;
    else break;
  }

  const hintBtn = document.getElementById('hint-btn');
  if (hintBtn) {
    if (attempts >= 2) {
      hintBtn.disabled = false;
      hintBtn.textContent = '💡 Hint (-150 pts)';
    } else {
      hintBtn.disabled = true;
      hintBtn.textContent = `💡 Hint (after ${2 - attempts} guess${2 - attempts > 1 ? 'es' : ''})`;
    }
  }
}

function useHint() {
  if (hintUsed) return;
  hintUsed = true;

  const hintBtn = document.getElementById('hint-btn');
  const hintDisplay = document.getElementById('hint-display');

  if (currentHint) {
    hintDisplay.textContent = currentHint;
    hintDisplay.classList.remove('hide');
  } else {
    hintDisplay.textContent = '💡 No hint available for this word';
    hintDisplay.classList.remove('hide');
  }

  if (hintBtn) {
    hintBtn.classList.add('used');
    hintBtn.disabled = true;
    hintBtn.textContent = '💡 Hint Used (-150 pts)';
  }

  saveGameState('IN_PROGRESS');
}

function disableHintButton() {
  const hintBtn = document.getElementById('hint-btn');
  if (hintBtn) {
    hintBtn.disabled = true;
    if (!hintUsed) {
      hintBtn.classList.add('used');
      hintBtn.textContent = '💡 Hint (-150 pts)';
    }
  }
}

function startLiveTimer() {
  const liveTimerValue = document.getElementById('live-timer-value');
  if (!liveTimerValue) return;

  function tick() {
    const elapsed = Date.now() - gameStartTime;
    const totalSeconds = Math.floor(elapsed / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    liveTimerValue.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  tick();
  liveTimerInterval = setInterval(tick, 1000);
}

function stopLiveTimer() {
  if (liveTimerInterval) {
    clearInterval(liveTimerInterval);
    liveTimerInterval = null;
  }
}

function formatElapsedTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

function calculateScore(isWin, attempts) {
  if (!isWin) return 0;
  const timeInSecs = Math.floor(gameElapsedMs / 1000);
  const hintPenalty = hintUsed ? 150 : 0;
  return Math.max(0, 1000 - ((100 * (attempts - 1)) + hintPenalty + timeInSecs));
}

function generateShareText(isWin) {
  const tiles = Array.from(guessGrid.querySelectorAll('.tile'));
  const filledRows = [];

  for (let r = 0; r < tries; r++) {
    const row = tiles.slice(r * wordLength, (r + 1) * wordLength);
    const hasState = row.some(t => t.dataset.state && t.dataset.state !== 'active');
    if (!hasState) break;

    const emojiRow = row.map(t => {
      switch (t.dataset.state) {
        case 'correct': return '🟩';
        case 'wrong-location': return '🟨';
        default: return '⬜';
      }
    }).join('');
    filledRows.push(emojiRow);
  }

  const guessCount = isWin ? filledRows.length : 'X';

  // Determine the puzzle date (respects ?offset for past puzzles)
  const urlParams = new URLSearchParams(window.location.search);
  const offset = parseInt(urlParams.get('offset')) || 0;
  const puzzleMs = Date.now() - offset * 86400000;
  const puzzleDate = new Date(puzzleMs);

  const day = puzzleDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' });
  const month = puzzleDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', month: 'long' });

  const header = `BPGC Wordle - ${day} ${month}`;
  let scoreLine = '';
  if (isWin) {
    scoreLine = `🏆 Score: ${calculateScore(isWin, guessCount)}`;
  }
  const solvedLine = `Solved in ${guessCount}/${tries} guesses`;

  let statsLine = '';
  if (isWin) {
    statsLine = `⏱️ ${formatElapsedTime(gameElapsedMs)}`;
    if (hintUsed) statsLine += ' | 💡 Used hint';
  } else if (hintUsed) {
    statsLine = '💡 Used hint';
  }

  const parts = [header, scoreLine, solvedLine, statsLine].filter(p => p.length > 0);
  return parts.join('\n') + '\n\n' + filledRows.join('\n');
}

function showTimer(isWin) {
  const endGameContainer = document.querySelector('[data-end-game]');
  const timerElement = document.querySelector('[data-timer]');
  const titleElement = document.querySelector('[data-end-game-title]');
  const targetWordDisplay = document.querySelector('[data-target-word-display]');
  const shareBtn = document.querySelector('[data-share-btn]');

  targetWordDisplay.textContent = targetWord.toUpperCase();

  // Show hint below the answer in the modal
  const hintDisplayModal = document.querySelector('[data-end-game-hint]');
  if (hintDisplayModal) {
    if (currentHint) {
      hintDisplayModal.textContent = '💡 ' + currentHint;
      hintDisplayModal.style.display = 'block';
    } else {
      hintDisplayModal.style.display = 'none';
    }
  }

  // Show solve time in the modal
  const solveTimeEl = document.querySelector('[data-solve-time]');
  const scoreEl = document.querySelector('[data-score]');
  if (solveTimeEl) {
    if (isWin) {
      solveTimeEl.textContent = `⏱️ Solved in ${formatElapsedTime(gameElapsedMs)}`;
      solveTimeEl.style.display = 'block';
    } else {
      solveTimeEl.style.display = 'none';
    }
  }

  if (scoreEl) {
    if (isWin) {
      const tiles = Array.from(guessGrid.querySelectorAll('.tile'));
      let attempts = 0;
      for (let r = 0; r < tries; r++) {
        const row = tiles.slice(r * wordLength, (r + 1) * wordLength);
        if (!row.some(t => t.dataset.state && t.dataset.state !== 'active')) break;
        attempts++;
      }
      const score = calculateScore(isWin, attempts);
      scoreEl.innerHTML = `🏆 Score: <strong>${score}</strong> <button class="info-btn" onclick="document.getElementById('info-modal').classList.remove('hide')" title="Points System">ⓘ</button>`;
      scoreEl.style.display = 'block';
    } else {
      scoreEl.style.display = 'none';
    }
  }

  if (isWin) {
    titleElement.textContent = "You Win! 🎉";
    titleElement.style.color = "var(--color-correct)";
  } else {
    titleElement.textContent = "Better Luck Next Time!";
    titleElement.style.color = "var(--color-tone-1)";
  }

  // Wire up share button
  shareBtn.onclick = () => {
    const text = generateShareText(isWin);
    navigator.clipboard.writeText(text).then(() => {
      shareBtn.textContent = 'Copied! ✅';
      shareBtn.classList.add('copied');
      setTimeout(() => {
        shareBtn.textContent = 'Share ⬆️';
        shareBtn.classList.remove('copied');
      }, 2000);
    }).catch(() => {
      // Fallback for older browsers / insecure contexts
      showAlert('Could not copy to clipboard');
    });
  };

  keyboard.classList.add('hide');
  endGameContainer.classList.remove('hide');

  let timerInterval;
  let initialDayIndex = getAbsoluteDayIndex(Date.now());

  function updateTimer() {
    const currentDayIndex = getAbsoluteDayIndex(Date.now());
    if (currentDayIndex > initialDayIndex) {
      clearInterval(timerInterval);
      location.reload();
      return;
    }

    const diffTime = Date.now() - START_DATE.getTime();
    const remainingMs = 86400000 - (diffTime % 86400000);

    const h = Math.floor(remainingMs / (1000 * 60 * 60));
    const m = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((remainingMs % (1000 * 60)) / 1000);

    const formattedHour = String(h).padStart(2, '0');
    const formattedMin = String(m).padStart(2, '0');
    const formattedSec = String(s).padStart(2, '0');

    timerElement.textContent = `${formattedHour}:${formattedMin}:${formattedSec}`;
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

fetchWords();

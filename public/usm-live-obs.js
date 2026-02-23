const REFRESH_INTERVAL_MS = 15000;
const STRIP_MAX_FONT_PX = 24;
const STRIP_MIN_FONT_PX = 8;
const brandingApi = window.ncaabsbBranding || null;
const stripTextMeasureCanvas = document.createElement("canvas");
const stripTextMeasureCtx = stripTextMeasureCanvas.getContext("2d");

const state = {
  selectedGameId: null,
  timer: null,
  stripFitFrame: null,
  stripAwaitingFirstPitch: false,
  stripAwaitingHalf: null,
  stripScoreBaseline: null,
  feedHasRendered: false,
  feedTopPlayKey: null,
};

const elements = {
  awayLogo: document.getElementById("away-logo"),
  homeLogo: document.getElementById("home-logo"),
  awayScore: document.getElementById("away-score"),
  homeScore: document.getElementById("home-score"),
  baseFirst: document.getElementById("base-first"),
  baseSecond: document.getElementById("base-second"),
  baseThird: document.getElementById("base-third"),
  gameStatus: document.getElementById("game-status"),
  outsStatus: document.getElementById("outs-status"),
  atbatCount: document.getElementById("atbat-count"),
  pitcherLine: document.getElementById("pitcher-line"),
  pitcherLineText: document.getElementById("pitcher-line-text"),
  batterLine: document.getElementById("batter-line"),
  batterLineText: document.getElementById("batter-line-text"),
  playFeed: document.getElementById("play-feed"),
};

void init();

async function init() {
  const params = new URLSearchParams(window.location.search);
  const idParam = Number.parseInt(params.get("id") || "", 10);
  state.selectedGameId = Number.isFinite(idParam) ? idParam : null;
  bootstrapStripTextNodes();

  await loadBranding();
  await fetchAndRender();

  window.addEventListener("resize", queueSyncMatchupFontSize);
  if (document.fonts?.ready) {
    document.fonts.ready.then(queueSyncMatchupFontSize).catch(() => {});
  }

  state.timer = setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
}

function bootstrapStripTextNodes() {
  elements.pitcherLineText = ensureStripTextNode(elements.pitcherLine, elements.pitcherLineText, "pitcher-line-text");
  elements.batterLineText = ensureStripTextNode(elements.batterLine, elements.batterLineText, "batter-line-text");
}

function ensureStripTextNode(container, textNode, id) {
  if (textNode) {
    return textNode;
  }
  if (!container) {
    return null;
  }

  const span = document.createElement("span");
  span.id = id;
  span.className = "strip-line-text";
  span.textContent = (container.textContent || "").trim() || "-";
  container.replaceChildren(span);
  return span;
}

async function loadBranding() {
  if (!brandingApi || typeof brandingApi.load !== "function") {
    return;
  }

  try {
    await brandingApi.load();
  } catch (_error) {
    // Branding is optional for OBS mode.
  }
}

async function fetchAndRender() {
  try {
    const payload = await fetchLivePayload(state.selectedGameId);
    render(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (elements.gameStatus) {
      elements.gameStatus.textContent = "Feed Error";
    }
    if (elements.outsStatus) {
      elements.outsStatus.textContent = "";
    }
    if (elements.atbatCount) {
      elements.atbatCount.textContent = "-";
    }
    if (elements.pitcherLineText) {
      elements.pitcherLineText.textContent = "--  P --";
    }
    if (elements.batterLineText) {
      elements.batterLineText.textContent = "--\u00A0\u00A0\u00A0---, -- HR, -- RBI";
    }
    queueSyncMatchupFontSize();
    if (elements.playFeed) {
      elements.playFeed.innerHTML = `<p class="empty">Load failed: ${message}</p>`;
    }
  }
}

async function fetchLivePayload(gameId) {
  const url = new URL("/api/usm/live", window.location.origin);
  if (gameId) {
    url.searchParams.set("id", String(gameId));
  }

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  return response.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function render(payload) {
  const selectedGameId = payload.selectedGameId || null;
  const selectedGame = payload.selectedGame || null;
  const live = payload.live || {};
  const summary = live.summary || null;
  const plays = Array.isArray(live.plays) ? live.plays : [];

  if (selectedGameId) {
    state.selectedGameId = selectedGameId;
  }

  renderScoreboard(summary, selectedGame);
  renderFeed(plays);
}

function renderScoreboard(summary, selectedGame) {
  const awayTeam = summary?.visitorTeam || selectedGame?.awayTeam || "Away";
  const homeTeam = summary?.homeTeam || selectedGame?.homeTeam || "Home";
  const situation = summary?.situation || null;
  const inningIndicator = buildInningIndicator(summary, selectedGame);

  renderTeamLogo(elements.awayLogo, awayTeam);
  renderTeamLogo(elements.homeLogo, homeTeam);

  elements.awayScore.textContent = formatScore(summary?.visitorScore);
  elements.homeScore.textContent = formatScore(summary?.homeScore);

  renderBaseDiamond(situation?.bases || null);
  renderInningIndicator(elements.gameStatus, summary, selectedGame);
  renderOutsDots(elements.outsStatus, situation);
  renderAtBatCount(elements.atbatCount, situation);
  renderMatchupStrip(situation, inningIndicator.half);
  syncMatchupStripVisibility(inningIndicator, summary, situation);
  applyStripBranding(awayTeam, homeTeam);
}

function renderTeamLogo(logoEl, teamName) {
  if (!logoEl) {
    return;
  }

  if (!brandingApi || typeof brandingApi.lookup !== "function" || typeof brandingApi.chooseLogo !== "function") {
    logoEl.hidden = true;
    logoEl.removeAttribute("src");
    return;
  }

  const branding = brandingApi.lookup(teamName);
  const logoSrc = brandingApi.chooseLogo(branding, { preferDark: false });
  if (!logoSrc) {
    logoEl.hidden = true;
    logoEl.removeAttribute("src");
    return;
  }

  logoEl.src = logoSrc;
  logoEl.alt = `${teamName} logo`;
  logoEl.hidden = false;
}

function renderFeed(plays) {
  const ordered = [...plays].reverse();
  const container = elements.playFeed;
  if (!container) {
    return;
  }

  if (ordered.length === 0) {
    container.innerHTML = '<p class="empty">No play-by-play data yet.</p>';
    state.feedHasRendered = false;
    state.feedTopPlayKey = null;
    return;
  }

  const previousRectsByKey = new Map();
  const existingByKey = new Map();
  container.querySelectorAll(".feed-item[data-play-key]").forEach((node) => {
    const key = node.getAttribute("data-play-key");
    if (!key) {
      return;
    }
    previousRectsByKey.set(key, node.getBoundingClientRect());
    existingByKey.set(key, node);
  });

  const topPlayKey = getFeedPlayKey(ordered[0], 0);
  const hasNewTopPlay =
    state.feedHasRendered &&
    typeof state.feedTopPlayKey === "string" &&
    state.feedTopPlayKey.length > 0 &&
    topPlayKey !== state.feedTopPlayKey;

  const fragment = document.createDocumentFragment();
  const renderedByKey = new Map();
  let previousHalfInning = null;

  for (let index = 0; index < ordered.length; index += 1) {
    const play = ordered[index];
    const olderPlay = index + 1 < ordered.length ? ordered[index + 1] : null;
    const scoringFromScores = didPlayScore(play, olderPlay);

    const halfInningLabel = toHalfInningLabel(play);
    if (halfInningLabel && halfInningLabel !== previousHalfInning) {
      const divider = document.createElement("div");
      divider.className = "feed-divider";
      divider.textContent = halfInningLabel;
      fragment.append(divider);
      previousHalfInning = halfInningLabel;
    }

    const key = getFeedPlayKey(play, index);
    let item = existingByKey.get(key);
    if (!item) {
      item = document.createElement("article");
      item.className = "feed-item";
      item.setAttribute("data-play-key", key);
      if (hasNewTopPlay) {
        item.classList.add("is-feed-entering");
        item.addEventListener(
          "animationend",
          () => {
            item.classList.remove("is-feed-entering");
          },
          { once: true }
        );
      }
    } else {
      item.classList.remove("is-feed-entering");
    }

    item.style.transform = "";
    item.style.transition = "";
    item.replaceChildren();

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = formatPlayDescription(play.text || "");
    item.append(text);

    const tag = classifyPlay(play, { scoringOverride: scoringFromScores });
    if (tag) {
      const chip = document.createElement("span");
      chip.className = `chip${tag.tone ? ` chip--${tag.tone}` : ""}`;
      chip.textContent = tag.label;
      item.append(chip);
    }

    fragment.append(item);
    renderedByKey.set(key, item);
  }

  container.replaceChildren(fragment);

  if (hasNewTopPlay) {
    animateFeedReorder(previousRectsByKey, renderedByKey);
  }

  state.feedHasRendered = true;
  state.feedTopPlayKey = topPlayKey;
}

function getFeedPlayKey(play, index) {
  const explicit = typeof play?.key === "string" ? play.key.trim() : "";
  if (explicit.length > 0) {
    return explicit;
  }

  const inning = Number.isFinite(play?.inning) ? Number(play.inning) : "u";
  const half = String(play?.half || "u");
  const order = Number.isFinite(play?.order) ? Number(play.order) : "u";
  const text = String(play?.text || "").trim();
  return `fallback:${inning}:${half}:${order}:${text || index}`;
}

function animateFeedReorder(previousRectsByKey, renderedByKey) {
  const movedNodes = [];

  for (const [key, node] of renderedByKey.entries()) {
    const previousRect = previousRectsByKey.get(key);
    if (!previousRect) {
      continue;
    }

    const nextRect = node.getBoundingClientRect();
    const deltaY = previousRect.top - nextRect.top;
    if (Math.abs(deltaY) < 0.5) {
      continue;
    }

    node.style.transition = "none";
    node.style.transform = `translateY(${deltaY}px)`;
    movedNodes.push(node);
  }

  if (movedNodes.length === 0) {
    return;
  }

  requestAnimationFrame(() => {
    for (const node of movedNodes) {
      node.style.transition = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1)";
      node.style.transform = "";
      node.addEventListener(
        "transitionend",
        () => {
          node.style.transition = "";
        },
        { once: true }
      );
    }
  });
}

function toHalfInningLabel(play) {
  if (!play || !Number.isFinite(play.inning) || !play.half) {
    return null;
  }
  return `${play.half === "top" ? "top" : "bot"} ${play.inning}`;
}

function didPlayScore(currentPlay, olderPlay) {
  if (!currentPlay || !olderPlay) {
    return false;
  }

  const currentAway = toScoreNumber(currentPlay.awayScore);
  const currentHome = toScoreNumber(currentPlay.homeScore);
  const olderAway = toScoreNumber(olderPlay.awayScore);
  const olderHome = toScoreNumber(olderPlay.homeScore);
  if (currentAway === null || currentHome === null || olderAway === null || olderHome === null) {
    return false;
  }

  return currentAway > olderAway || currentHome > olderHome;
}

function toScoreNumber(value) {
  if (Number.isFinite(value)) {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function buildInningIndicator(summary, selectedGame) {
  const situation = summary?.situation || null;
  const inningFromSituation = Number.isFinite(situation?.inning) ? Number(situation.inning) : null;
  const halfFromSituation = normalizeHalf(situation?.half);
  if (inningFromSituation !== null && halfFromSituation) {
    return {
      half: halfFromSituation,
      inning: inningFromSituation,
      text: null,
    };
  }

  const statusText = String(summary?.statusText || selectedGame?.statusText || "Pregame");
  const parsedMidEnd = parseMidEndFromStatus(statusText);
  if (parsedMidEnd) {
    return {
      half: null,
      inning: parsedMidEnd.inning,
      phase: parsedMidEnd.phase,
      text: null,
    };
  }

  const parsed = parseInningFromStatus(statusText);
  if (parsed) {
    return {
      half: parsed.half,
      inning: parsed.inning,
      phase: null,
      text: null,
    };
  }

  return {
    half: null,
    inning: null,
    phase: null,
    text: statusText,
  };
}

function renderInningIndicator(target, summary, selectedGame) {
  target.replaceChildren();
  const indicator = buildInningIndicator(summary, selectedGame);
  if (indicator.phase && Number.isFinite(indicator.inning)) {
    const phase = document.createElement("span");
    phase.className = "inning-phase";
    phase.textContent = indicator.phase;

    const number = document.createElement("span");
    number.className = "inning-number";
    number.textContent = String(indicator.inning);

    target.append(phase, number);
    return;
  }

  if (indicator.half && Number.isFinite(indicator.inning)) {
    const arrow = document.createElement("span");
    arrow.className = "inning-arrow";
    arrow.textContent = indicator.half === "top" ? "▲" : "▼";

    const number = document.createElement("span");
    number.className = "inning-number";
    number.textContent = String(indicator.inning);

    target.append(arrow, number);
    return;
  }

  target.textContent = indicator.text || "Pregame";
}

function renderOutsDots(target, situation) {
  target.replaceChildren();
  const outsRaw = Number.isFinite(situation?.outs) ? Math.trunc(Number(situation.outs)) : 0;
  const outs = Math.max(0, Math.min(3, outsRaw));

  const wrap = document.createElement("span");
  wrap.className = "outs-dots";
  wrap.setAttribute("aria-label", `${outs} ${outs === 1 ? "out" : "outs"}`);

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.className = `out-dot${index < outs ? " is-filled" : ""}`;
    wrap.append(dot);
  }

  target.append(wrap);
}

function renderAtBatCount(target, situation) {
  if (!target) {
    return;
  }

  const ballsRaw = Number.isFinite(situation?.count?.balls) ? Math.trunc(Number(situation.count.balls)) : null;
  const strikesRaw = Number.isFinite(situation?.count?.strikes)
    ? Math.trunc(Number(situation.count.strikes))
    : null;

  if (ballsRaw === null && strikesRaw === null) {
    target.textContent = "-";
    target.setAttribute("aria-label", "At-bat count unavailable");
    return;
  }

  const balls = ballsRaw === null ? "-" : String(Math.max(0, Math.min(3, ballsRaw)));
  const strikes = strikesRaw === null ? "-" : String(Math.max(0, Math.min(2, strikesRaw)));
  const value = `${balls}-${strikes}`;
  target.textContent = value;
  target.setAttribute("aria-label", `At-bat count ${value}`);
}

function renderMatchupStrip(situation, inningHalf) {
  const batterLine = formatBatterDisplay(situation?.batter);
  const pitcherLine = formatPitcherDisplay(situation?.pitcher?.name, situation?.pitcher?.pitchCount);
  const half = normalizeHalf(inningHalf);

  // Left strip is always the away team. Right strip is always the home team.
  let awayText = pitcherLine;
  let homeText = batterLine;
  if (half === "top") {
    awayText = batterLine;
    homeText = pitcherLine;
  } else if (half === "bottom") {
    awayText = pitcherLine;
    homeText = batterLine;
  }

  if (elements.pitcherLineText) {
    elements.pitcherLineText.textContent = awayText;
  }

  if (elements.batterLineText) {
    elements.batterLineText.textContent = homeText;
  }

  queueSyncMatchupFontSize();
}

function syncMatchupStripVisibility(indicator, summary, situation) {
  const phase = String(indicator?.phase || "").toUpperCase();
  const inning = Number.isFinite(indicator?.inning) ? Number(indicator.inning) : null;
  const half = normalizeHalf(indicator?.half);

  if ((phase === "MID" || phase === "END") && inning !== null) {
    const expectedHalf = getExpectedHalfAfterPhase(phase, inning);
    state.stripAwaitingFirstPitch = true;
    state.stripAwaitingHalf = expectedHalf;
    state.stripScoreBaseline = {
      away: toScoreNumber(summary?.visitorScore),
      home: toScoreNumber(summary?.homeScore),
    };
    setMatchupStripHidden(true);
    return;
  }

  if (!state.stripAwaitingFirstPitch) {
    setMatchupStripHidden(false);
    return;
  }

  if (!half || inning === null) {
    setMatchupStripHidden(true);
    return;
  }

  if (state.stripAwaitingHalf) {
    const awaitingHalf = normalizeHalf(state.stripAwaitingHalf.half);
    const awaitingInning = Number.isFinite(state.stripAwaitingHalf.inning)
      ? Number(state.stripAwaitingHalf.inning)
      : null;
    if (!awaitingHalf || awaitingInning === null || awaitingHalf !== half || awaitingInning !== inning) {
      setMatchupStripHidden(true);
      return;
    }
  }

  if (didFirstPitchHappen(situation, summary)) {
    state.stripAwaitingFirstPitch = false;
    state.stripAwaitingHalf = null;
    state.stripScoreBaseline = null;
    setMatchupStripHidden(false);
    return;
  }

  setMatchupStripHidden(true);
}

function getExpectedHalfAfterPhase(phase, inning) {
  if (phase === "MID") {
    return { half: "bottom", inning };
  }
  return { half: "top", inning: inning + 1 };
}

function didFirstPitchHappen(situation, summary) {
  const balls = Number.isFinite(situation?.count?.balls) ? Math.max(0, Math.trunc(Number(situation.count.balls))) : 0;
  const strikes = Number.isFinite(situation?.count?.strikes) ? Math.max(0, Math.trunc(Number(situation.count.strikes))) : 0;
  if (balls > 0 || strikes > 0) {
    return true;
  }

  const outs = Number.isFinite(situation?.outs) ? Math.max(0, Math.trunc(Number(situation.outs))) : 0;
  if (outs > 0) {
    return true;
  }

  const bases = situation?.bases || null;
  if (bases && (toBaseOccupied(bases.first) || toBaseOccupied(bases.second) || toBaseOccupied(bases.third))) {
    return true;
  }

  const baselineAway = toScoreNumber(state.stripScoreBaseline?.away);
  const baselineHome = toScoreNumber(state.stripScoreBaseline?.home);
  const currentAway = toScoreNumber(summary?.visitorScore);
  const currentHome = toScoreNumber(summary?.homeScore);
  if (baselineAway !== null && currentAway !== null && currentAway > baselineAway) {
    return true;
  }
  if (baselineHome !== null && currentHome !== null && currentHome > baselineHome) {
    return true;
  }

  return false;
}

function setMatchupStripHidden(hidden) {
  if (elements.pitcherLine) {
    elements.pitcherLine.classList.toggle("is-strip-hidden", hidden);
  }
  if (elements.batterLine) {
    elements.batterLine.classList.toggle("is-strip-hidden", hidden);
  }
}

function queueSyncMatchupFontSize() {
  if (state.stripFitFrame !== null) {
    cancelAnimationFrame(state.stripFitFrame);
  }

  state.stripFitFrame = requestAnimationFrame(() => {
    state.stripFitFrame = null;
    syncMatchupFontSize();
  });
}

function syncMatchupFontSize() {
  const leftContainer = elements.pitcherLine;
  const rightContainer = elements.batterLine;
  const leftText = elements.pitcherLineText;
  const rightText = elements.batterLineText;
  if (!leftContainer || !rightContainer || !leftText || !rightText) {
    return;
  }

  const leftAvailable = getTextContentWidth(leftContainer);
  const rightAvailable = getTextContentWidth(rightContainer);
  if (leftAvailable <= 0 || rightAvailable <= 0) {
    return;
  }

  const leftValue = leftText.textContent ?? "";
  const rightValue = rightText.textContent ?? "";
  const leftStyles = window.getComputedStyle(leftText);
  const rightStyles = window.getComputedStyle(rightText);

  let fontSize = STRIP_MAX_FONT_PX;

  while (fontSize > STRIP_MIN_FONT_PX) {
    const leftWidth = measureStripTextWidth(leftValue, leftStyles, fontSize);
    const rightWidth = measureStripTextWidth(rightValue, rightStyles, fontSize);
    if (leftWidth <= leftAvailable && rightWidth <= rightAvailable) {
      break;
    }
    fontSize -= 1;
  }

  leftText.style.fontSize = `${fontSize}px`;
  rightText.style.fontSize = `${fontSize}px`;
}

function getTextContentWidth(container) {
  const styles = window.getComputedStyle(container);
  const leftPad = Number.parseFloat(styles.paddingLeft) || 0;
  const rightPad = Number.parseFloat(styles.paddingRight) || 0;
  return Math.max(0, container.clientWidth - leftPad - rightPad);
}

function measureStripTextWidth(text, styles, fontSizePx) {
  if (!stripTextMeasureCtx) {
    return Number.POSITIVE_INFINITY;
  }

  const fontStyle = styles.fontStyle || "normal";
  const fontVariant = styles.fontVariant || "normal";
  const fontWeight = styles.fontWeight || "700";
  const fontFamily = styles.fontFamily || "Inter, sans-serif";

  stripTextMeasureCtx.font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSizePx}px ${fontFamily}`;
  const baseWidth = stripTextMeasureCtx.measureText(text).width;

  const letterSpacingRaw = Number.parseFloat(styles.letterSpacing);
  const letterSpacing = Number.isFinite(letterSpacingRaw) ? letterSpacingRaw : 0;
  const letterSpacingWidth = Math.max(0, text.length - 1) * letterSpacing;

  return baseWidth + letterSpacingWidth;
}

function applyStripBranding(awayTeam, homeTeam) {
  const away = getTeamPrimaryColor(awayTeam) || "#8a0014";
  const home = getTeamPrimaryColor(homeTeam) || "#070707";

  // Keep team colors fixed by side: away on left strip, home on right strip.
  applyStripColors(elements.pitcherLine, away);
  applyStripColors(elements.batterLine, home);
}

function getTeamPrimaryColor(teamName) {
  if (!brandingApi || typeof brandingApi.lookup !== "function") {
    return null;
  }
  const branding = brandingApi.lookup(teamName);
  const safeColor = brandingApi.safeColor;
  if (typeof safeColor !== "function") {
    return null;
  }

  return safeColor(branding?.colors?.primary) || safeColor(branding?.colors?.espnPrimary) || null;
}

function applyStripColors(node, background) {
  if (!node) {
    return;
  }
  node.style.backgroundColor = background;
  node.style.color = chooseReadableTextColor(background);
}

function chooseReadableTextColor(hexColor) {
  const clean = String(hexColor || "").replace(/^#/u, "");
  if (!/^[0-9a-fA-F]{6}$/u.test(clean)) {
    return "#F8FBFF";
  }

  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  return luminance > 150 ? "#0B0E14" : "#F8FBFF";
}

function normalizePlayerLabel(value) {
  const text = prettifyNames(value || "").trim().toUpperCase();
  return text.length > 0 ? text : "-";
}

function formatPitcherDisplay(name, pitchCount) {
  const lastName = normalizePitcherLastName(name);
  const rawCount = Number.isFinite(pitchCount) ? Math.trunc(Number(pitchCount)) : null;
  const countLabel = rawCount !== null && rawCount >= 0 ? String(rawCount) : "--";
  return `${lastName}\u00A0\u00A0\u00A0P ${countLabel}`;
}

function formatBatterDisplay(batter) {
  const lastName = normalizePitcherLastName(batter?.name);
  const avg = normalizeAverageLabel(batter?.seasonAvg);
  const hr = Number.isFinite(batter?.seasonHomeRuns) ? String(Math.max(0, Math.trunc(Number(batter.seasonHomeRuns)))) : "--";
  const rbis = Number.isFinite(batter?.seasonRbis) ? String(Math.max(0, Math.trunc(Number(batter.seasonRbis)))) : "--";
  return `${lastName}\u00A0\u00A0\u00A0${avg}, ${hr} HR, ${rbis} RBI`;
}

function normalizePitcherLastName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "--";
  }

  if (raw.includes(",")) {
    const [lastPart] = raw.split(",", 1);
    const lastName = toTitle(lastPart || "");
    return lastName || "--";
  }

  const pretty = prettifyNames(raw).trim();
  if (!pretty) {
    return "--";
  }

  const tokens = pretty.split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? toTitle(tokens[tokens.length - 1]) : "--";
}

function normalizeAverageLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "---";
  }

  if (/^\.\d{3,}$/u.test(text)) {
    return text.slice(0, 4);
  }

  if (/^\d\.\d{3,}$/u.test(text)) {
    return text.slice(-4);
  }

  if (/^\d+$/u.test(text)) {
    const padded = text.padStart(3, "0").slice(-3);
    return `.${padded}`;
  }

  return text;
}

function renderBaseDiamond(bases) {
  const occupied = normalizeBaseOccupancy(bases);
  setBaseOccupied(elements.baseFirst, occupied.first);
  setBaseOccupied(elements.baseSecond, occupied.second);
  setBaseOccupied(elements.baseThird, occupied.third);
}

function setBaseOccupied(node, occupied) {
  if (!node) {
    return;
  }
  node.classList.toggle("is-occupied", occupied);
}

function normalizeBaseOccupancy(bases) {
  const mask = parseMaskValue(bases?.mask);
  const decoded = decodeBaseMask(mask);
  const firstExplicit = readExplicitBaseOccupancy(bases?.first);
  const secondExplicit = readExplicitBaseOccupancy(bases?.second);
  const thirdExplicit = readExplicitBaseOccupancy(bases?.third);

  return {
    first: firstExplicit ?? decoded.first ?? toBaseOccupied(bases?.first),
    second: secondExplicit ?? decoded.second ?? toBaseOccupied(bases?.second),
    third: thirdExplicit ?? decoded.third ?? toBaseOccupied(bases?.third),
  };
}

function decodeBaseMask(mask) {
  if (mask === null) {
    return { first: null, second: null, third: null };
  }

  const mappedByIcon = {
    0: { first: false, second: false, third: false },
    1: { first: true, second: false, third: false },
    2: { first: false, second: true, third: false },
    3: { first: false, second: false, third: true },
    4: { first: true, second: true, third: false },
    5: { first: false, second: true, third: true },
    6: { first: true, second: false, third: true },
    7: { first: true, second: true, third: true },
  };

  if (Object.prototype.hasOwnProperty.call(mappedByIcon, mask)) {
    return mappedByIcon[mask];
  }

  return {
    first: (mask & 1) === 1,
    second: (mask & 2) === 2,
    third: (mask & 4) === 4,
  };
}

function readExplicitBaseOccupancy(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function parseMaskValue(value) {
  if (Number.isFinite(value)) {
    return Math.max(0, Math.min(7, Math.trunc(Number(value))));
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(7, parsed));
    }
  }
  return null;
}

function toBaseOccupied(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean.length === 0) {
      return false;
    }
    if (["0", "false", "no", "off", "empty", "none", "-"].includes(clean)) {
      return false;
    }
    if (["1", "true", "yes", "on", "occupied"].includes(clean)) {
      return true;
    }
    return true;
  }
  if (value && typeof value === "object") {
    return true;
  }
  return false;
}

function parseInningFromStatus(text) {
  const match = String(text || "").match(/\b(top|bot|bottom)\b(?:\s+of)?(?:\s+the)?\s*(\d+)/i);
  if (!match) {
    return null;
  }
  const inning = Number.parseInt(match[2], 10);
  if (!Number.isFinite(inning)) {
    return null;
  }
  return {
    half: /^top/i.test(match[1]) ? "top" : "bottom",
    inning,
  };
}

function parseMidEndFromStatus(text) {
  const match = String(text || "").match(/\b(mid|middle|end)\b(?:\s+of)?(?:\s+the)?\s*(\d+)/i);
  if (!match) {
    return null;
  }

  const inning = Number.parseInt(match[2], 10);
  if (!Number.isFinite(inning)) {
    return null;
  }

  return {
    phase: /^end/i.test(match[1]) ? "END" : "MID",
    inning,
  };
}

function normalizeHalf(value) {
  const text = String(value || "").toLowerCase();
  if (text === "top") {
    return "top";
  }
  if (text === "bottom" || text === "bot") {
    return "bottom";
  }
  return null;
}

function classifyPlay(play, options = {}) {
  const text = String(play?.text || "");
  const scoringDecision = String(play?.scoringDecision || "");
  const lower = text.toLowerCase();
  const scoring = Boolean(options.scoringOverride) || isScoringPlay(lower, scoringDecision);
  const reachesBase = isReachesBasePlay(lower);
  const out = isOutPlay(lower);

  if (lower.includes("home run") || lower.includes("homered")) return { label: "Home Run", tone: "scoring" };
  if (lower.includes("doubled")) return { label: "Double", tone: toneWithScoring("onbase", scoring) };
  if (lower.includes("tripled")) return { label: "Triple", tone: toneWithScoring("onbase", scoring) };
  if (lower.includes("singled")) return { label: "Single", tone: toneWithScoring("onbase", scoring) };
  if (lower.includes("walked") || lower.includes("intentional walk")) return { label: "Walk", tone: toneWithScoring("onbase", scoring) };
  if (lower.includes("hit by pitch") || /\bhbp\b/u.test(lower)) return { label: "HBP", tone: toneWithScoring("onbase", scoring) };
  if (lower.includes("struck out") || lower.includes("strikeout")) return { label: "Strikeout", tone: toneWithScoring("out", scoring) };
  if (lower.includes("pinch hit")) return { label: "Pinch Hit", tone: scoring ? "scoring" : null };
  if (lower.includes("to p for")) return { label: "Pitching Change", tone: null };
  if (lower.includes("stole") || lower.includes("stolen base")) return { label: "Stolen Base", tone: toneWithScoring("onbase", scoring) };
  if (scoring) return { label: "Scoring Play", tone: "scoring" };
  if (reachesBase) return { label: "On Base", tone: "onbase" };
  if (out) return { label: "Out", tone: "out" };
  return null;
}

function formatPlayDescription(text) {
  return expandPositionAbbreviations(uppercasePitchSequenceCodes(prettifyNames(text)));
}

function uppercasePitchSequenceCodes(text) {
  return String(text || "").replace(/\((\d+\s*-\s*\d+)\s+([A-Za-z]+)\)/g, (_match, count, sequence) => {
    const sequenceText = String(sequence || "");
    if (sequenceText.toLowerCase() === "count") {
      return `(${count} count)`;
    }
    return `(${count} ${sequenceText.toUpperCase()})`;
  });
}

function expandPositionAbbreviations(text) {
  let output = String(text || "");

  const multiTokenMap = {
    "1b": "first base",
    "2b": "second base",
    "3b": "third base",
    ss: "shortstop",
    lf: "left field",
    cf: "center field",
    rf: "right field",
    dh: "designated hitter",
    ph: "pinch hitter",
    pr: "pinch runner",
  };

  output = output.replace(/\b(1b|2b|3b|ss|lf|cf|rf|dh|ph|pr)\b/gi, (token) => {
    const replacement = multiTokenMap[String(token).toLowerCase()];
    return replacement || token;
  });

  output = output
    .replace(/\bc to\b/gi, "catcher to")
    .replace(/\bp to\b/gi, "pitcher to")
    .replace(/\bto c\b/gi, "to catcher")
    .replace(/\bto p\b/gi, "to pitcher")
    .replace(/\bby c\b/gi, "by catcher")
    .replace(/\bby p\b/gi, "by pitcher")
    .replace(/\bfor c\b/gi, "for catcher")
    .replace(/\bfor p\b/gi, "for pitcher");

  return output;
}

function toneWithScoring(baseTone, scoring) {
  return scoring ? "scoring" : baseTone;
}

function isScoringPlay(lowerText, scoringDecisionText) {
  const decision = String(scoringDecisionText || "").toLowerCase();
  return (
    /\bscor(?:ed|es|ing)\b|home run|homered|grand slam|walk-off|\brbi\b|\b\d+\s*rbi\b/u.test(lowerText) ||
    /\brbi\b|\b\d+\s*rbi\b/u.test(decision)
  );
}

function isReachesBasePlay(lower) {
  return (
    /\bsingled\b|\bdoubled\b|\btripled\b|\bwalked\b|\bintentional walk\b|\bhit by pitch\b|\bhbp\b/u.test(lower) ||
    /\breached on\b|\breaches on\b|\breached first\b|\breaches first\b|\bsafe on\b/u.test(lower) ||
    /\bcatcher'?s interference\b|\bon error\b|\bstole\b|\bstolen base\b/u.test(lower)
  );
}

function isOutPlay(lower) {
  return (
    /\bstruck out\b|\bstrikeout\b|\bflied out\b|\bgrounded out\b|\blined out\b|\bfouled out\b|\bpopped up\b/u.test(lower) ||
    /\binfield fly\b|\bdouble play\b|\btriple play\b|\bout at (?:first|second|third|home)\b/u.test(lower)
  );
}

function prettifyNames(text) {
  if (!text) return "";
  return text
    .replace(/\b([A-Z][A-Za-z'.-]+),\s*([A-Z][A-Za-z'.-]+)\b/g, (_m, last, first) => {
      return `${toTitle(first)} ${toTitle(last)}`;
    })
    .replace(/\b([A-Z]{3,})\b/g, (word) => (word === word.toUpperCase() ? toTitle(word) : word));
}

function toTitle(value) {
  return String(value)
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((token) => (/^[\s-']+$/.test(token) ? token : token.charAt(0).toUpperCase() + token.slice(1)))
    .join("");
}

function formatScore(value) {
  return Number.isFinite(value) ? String(value) : "-";
}

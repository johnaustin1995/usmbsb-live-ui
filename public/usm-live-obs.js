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
    if (elements.pitcherLineText) {
      elements.pitcherLineText.textContent = "PITCHER - -";
    }
    if (elements.batterLineText) {
      elements.batterLineText.textContent = "BATTER - -";
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
  renderMatchupStrip(situation, inningIndicator.half);
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
  elements.playFeed.innerHTML = "";

  if (ordered.length === 0) {
    elements.playFeed.innerHTML = '<p class="empty">No play-by-play data yet.</p>';
    return;
  }

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
      elements.playFeed.append(divider);
      previousHalfInning = halfInningLabel;
    }

    const item = document.createElement("article");
    item.className = "feed-item";

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

    elements.playFeed.append(item);
  }
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
  const parsed = parseInningFromStatus(statusText);
  if (parsed) {
    return {
      half: parsed.half,
      inning: parsed.inning,
      text: null,
    };
  }

  return {
    half: null,
    inning: null,
    text: statusText,
  };
}

function renderInningIndicator(target, summary, selectedGame) {
  target.replaceChildren();
  const indicator = buildInningIndicator(summary, selectedGame);
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

function renderMatchupStrip(situation, inningHalf) {
  const batter = normalizePlayerLabel(situation?.batter?.name);
  const pitcher = normalizePlayerLabel(situation?.pitcher?.name);
  const half = normalizeHalf(inningHalf);

  // Left strip is always the away team. Right strip is always the home team.
  const awayRole = half === "top" ? "BATTER" : "PITCHER";
  const homeRole = half === "top" ? "PITCHER" : "BATTER";
  const awayName = half === "top" ? batter : pitcher;
  const homeName = half === "top" ? pitcher : batter;

  if (elements.pitcherLineText) {
    elements.pitcherLineText.textContent = `${awayRole} - ${awayName}`;
  }

  if (elements.batterLineText) {
    elements.batterLineText.textContent = `${homeRole} - ${homeName}`;
  }

  queueSyncMatchupFontSize();
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
  const firstFromMask = mask !== null ? (mask & 1) === 1 : null;
  const secondFromMask = mask !== null ? (mask & 2) === 2 : null;
  const thirdFromMask = mask !== null ? (mask & 4) === 4 : null;

  return {
    first: firstFromMask ?? toBaseOccupied(bases?.first),
    second: secondFromMask ?? toBaseOccupied(bases?.second),
    third: thirdFromMask ?? toBaseOccupied(bases?.third),
  };
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
    return `(${count} ${String(sequence).toUpperCase()})`;
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
    .replace(/\b([A-Za-z][A-Za-z'.-]+),\s*([A-Za-z][A-Za-z'.-]+)\b/g, (_m, last, first) => {
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

// --- Zakładka Wykresy: rysowane w SVG, bez bibliotek, więc działają też bez internetu ---

const CHART_MONTHS_BACK = 6;
const CHART_TOP_CATEGORIES = 5;
const CHART_HEIGHT = 190;
const SVG_NS = "http://www.w3.org/2000/svg";

const YEAR_MONTHS = 12;

function selectedMonth() {
  return new Date(summaryYear, summaryMonth, 1);
}

function svgElement(tag, attributes, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  if (parent) parent.append(el);
  return el;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isCurrentMonth(date) {
  return monthKey(date) === monthKey(new Date());
}

function transactionsInMonth(kind, key) {
  return ledger(kind).transactions.filter((t) => t.date.startsWith(key));
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Czytelne wartości osi: 100, 250, 500, 1000...
function niceMax(value) {
  if (value <= 0) return 100;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value);
  return step * power;
}

function formatTick(value) {
  if (value < 1000) return String(value);
  return `${String(value / 1000).replace(".", ",")} tys.`;
}

function signedMoney(grosze) {
  const sign = grosze > 0 ? "+" : grosze < 0 ? "−" : "";
  return sign + formatMoney(Math.abs(grosze));
}

function plotArea(containerId, padding) {
  const container = $(containerId);
  container.replaceChildren();
  const width = container.clientWidth;
  const svg = svgElement("svg", {
    width,
    height: CHART_HEIGHT,
    viewBox: `0 0 ${width} ${CHART_HEIGHT}`,
    class: "chart-svg",
  }, container);
  return {
    svg,
    width,
    left: padding.left,
    right: width - padding.right,
    top: padding.top,
    bottom: CHART_HEIGHT - padding.bottom,
  };
}

// Trzy cienkie linie siatki z podpisami; wartości w złotych.
function drawGrid(plot, maxValue) {
  const y = (value) => plot.bottom - (value / maxValue) * (plot.bottom - plot.top);
  for (const value of [0, maxValue / 2, maxValue]) {
    svgElement("line", {
      x1: plot.left, x2: plot.right, y1: y(value), y2: y(value), class: "chart-grid",
    }, plot.svg);
    const label = svgElement("text", {
      x: plot.left - 6, y: y(value) + 4, "text-anchor": "end", class: "chart-tick",
    }, plot.svg);
    label.textContent = formatTick(value);
  }
  return y;
}

function renderLegend(id, items) {
  const box = $(id);
  box.replaceChildren();
  for (const { label, className } of items) {
    const row = element("span", "legend-item");
    row.append(element("span", `legend-key ${className}`), element("span", "", label));
    box.append(row);
  }
}

function renderChartTable(id, headers, rows) {
  const table = element("table", "chart-table");
  const head = element("tr");
  for (const header of headers) head.append(element("th", "", header));
  table.append(head);
  for (const cells of rows) {
    const row = element("tr");
    for (const cell of cells) row.append(element("td", "", cell));
    table.append(row);
  }
  $(id).replaceChildren(table);
}

// --- Dymek z wartościami: najpierw liczba, potem nazwa ---

function showChartTooltip(title, rows, clientX, clientY) {
  const tooltip = $("chart-tooltip");
  tooltip.replaceChildren(element("div", "tooltip-title", title));
  for (const { value, label, className } of rows) {
    const row = element("div", "tooltip-row");
    row.append(
      element("span", `tooltip-key ${className || ""}`),
      element("strong", "", value),
      element("span", "tooltip-label", label),
    );
    tooltip.append(row);
  }
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(window.innerWidth - box.width - margin, Math.max(margin, clientX - box.width / 2));
  const above = clientY - box.height - 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${above > margin ? above : clientY + 18}px`;
}

function hideChartTooltip() {
  $("chart-tooltip").hidden = true;
}

// --- Wykres 1: wpływy i wydatki z ostatnich miesięcy ---

function renderFlowChart() {
  const isYear = summaryMode === "year";
  const lastMonth = isYear ? new Date(summaryYear, YEAR_MONTHS - 1, 1) : selectedMonth();
  const count = isYear ? YEAR_MONTHS : CHART_MONTHS_BACK;
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = addMonths(lastMonth, -i);
    const key = monthKey(date);
    months.push({
      date,
      income: sumOf(transactionsInMonth("income", key)),
      expense: sumOf(transactionsInMonth("expense", key)),
    });
  }

  const totalIncome = months.reduce((sum, m) => sum + m.income, 0);
  const totalExpense = months.reduce((sum, m) => sum + m.expense, 0);
  const hasData = totalIncome + totalExpense > 0;
  $("flow-headline").textContent = hasData
    ? `${isYear ? `Bilans ${summaryYear}` : `Bilans z ${CHART_MONTHS_BACK} miesięcy`}: ${signedMoney(totalIncome - totalExpense)}`
    : "Dodaj wpływy i wydatki, a pojawi się tu ich porównanie";
  $("flow-legend").hidden = !hasData;
  $("flow-details").hidden = !hasData;
  if (!hasData) {
    $("flow-chart").replaceChildren();
    return;
  }

  renderLegend("flow-legend", [
    { label: "Wpływy", className: "key-income" },
    { label: "Wydatki", className: "key-expense" },
  ]);

  const plot = plotArea("flow-chart", { left: 46, right: 2, top: 10, bottom: 24 });
  const largest = Math.max(...months.map((m) => Math.max(m.income, m.expense))) / 100;
  const maxValue = niceMax(largest);
  const y = drawGrid(plot, maxValue);
  const band = (plot.right - plot.left) / months.length;
  const barWidth = Math.min(16, (band - (isYear ? 5 : 14)) / 2);

  months.forEach((month, index) => {
    const center = plot.left + band * (index + 0.5);
    const group = svgElement("g", { class: "chart-band" }, plot.svg);
    svgElement("rect", {
      x: plot.left + band * index + 2,
      y: plot.top - 6,
      width: band - 4,
      height: plot.bottom - plot.top + 6,
      rx: 8,
      class: "chart-band-highlight",
    }, group);

    drawColumn(group, center - barWidth - 1, barWidth, month.income / 100, y, plot.bottom, "bar-income");
    drawColumn(group, center + 1, barWidth, month.expense / 100, y, plot.bottom, "bar-expense");

    const selected = !isYear && index === months.length - 1;
    const label = svgElement("text", {
      x: center,
      y: CHART_HEIGHT - 7,
      "text-anchor": "middle",
      class: selected ? "chart-tick chart-tick-strong" : "chart-tick",
    }, group);
    label.textContent = MONTHS_SHORT[month.date.getMonth()];

    const title = `${MONTHS[month.date.getMonth()]} ${month.date.getFullYear()}`;
    const rows = [
      { value: formatMoney(month.income), label: "wpływy", className: "key-income" },
      { value: formatMoney(month.expense), label: "wydatki", className: "key-expense" },
      { value: signedMoney(month.income - month.expense), label: "bilans" },
    ];
    // Cały pas miesiąca reaguje na palec, nie tylko wąski słupek.
    const hit = svgElement("rect", {
      x: plot.left + band * index,
      y: 0,
      width: band,
      height: CHART_HEIGHT,
      class: "chart-hit",
      tabindex: 0,
      role: "img",
      "data-chart-hit": "true",
      "aria-label": `${title}: wpływy ${formatMoney(month.income)}, wydatki ${formatMoney(month.expense)}`,
    }, group);
    const show = (event) => {
      showChartTooltip(title, rows, event.clientX, event.clientY);
    };
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") hideChartTooltip();
    });
    hit.addEventListener("focus", () => {
      const box = hit.getBoundingClientRect();
      showChartTooltip(title, rows, box.left + box.width / 2, box.top + 20);
    });
    hit.addEventListener("blur", hideChartTooltip);
  });

  renderChartTable("flow-table", ["Miesiąc", "Wpływy", "Wydatki", "Bilans"], months.map((m) => [
    `${MONTHS_SHORT[m.date.getMonth()]} ${m.date.getFullYear()}`,
    formatNumber(m.income),
    formatNumber(m.expense),
    signedMoney(m.income - m.expense).replace(" PLN", ""),
  ]));
}

// Słupek z zaokrągloną górą, prosty przy podstawie.
function drawColumn(parent, x, width, value, y, baseline, className) {
  if (value <= 0) return;
  const top = Math.min(y(value), baseline - 2);
  const radius = Math.min(4, width / 2, baseline - top);
  const d = `M${x} ${baseline}V${top + radius}Q${x} ${top} ${x + radius} ${top}`
    + `H${x + width - radius}Q${x + width} ${top} ${x + width} ${top + radius}V${baseline}Z`;
  svgElement("path", { d, class: `chart-bar ${className}` }, parent);
}

// --- Wykres 2: tempo wydawania w miesiącu na tle poprzedniego ---

function cumulativeByDay(date, lastDay) {
  const totals = new Array(lastDay + 1).fill(0);
  for (const transaction of transactionsInMonth("expense", monthKey(date))) {
    const day = Number(transaction.date.slice(8, 10));
    if (day <= lastDay) totals[day] += transaction.grosze;
  }
  for (let day = 1; day <= lastDay; day++) totals[day] += totals[day - 1];
  return totals;
}

function cumulativeByMonth(year, lastMonth) {
  const totals = new Array(lastMonth + 1).fill(0);
  for (const transaction of transactionsInMonth("expense", String(year))) {
    const month = Number(transaction.date.slice(5, 7));
    if (month <= lastMonth) totals[month] += transaction.grosze;
  }
  for (let month = 1; month <= lastMonth; month++) totals[month] += totals[month - 1];
  return totals;
}

// Dane drugiego wykresu: dni miesiąca na tle poprzedniego albo miesiące roku na tle poprzedniego.
function paceSeries() {
  const today = new Date();
  if (summaryMode === "year") {
    const ongoing = summaryYear === today.getFullYear();
    const lastPoint = ongoing ? today.getMonth() + 1 : YEAR_MONTHS;
    return {
      ongoing,
      unit: "rok",
      lastPoint,
      previousLastPoint: YEAR_MONTHS,
      lastX: YEAR_MONTHS,
      current: cumulativeByMonth(summaryYear, lastPoint),
      previous: cumulativeByMonth(summaryYear - 1, YEAR_MONTHS),
      currentName: String(summaryYear),
      previousName: String(summaryYear - 1),
      ticks: [1, 4, 7, 10, YEAR_MONTHS],
      tickLabel: (month) => MONTHS_SHORT[month - 1],
      pointTitle: (month) => `Do końca: ${MONTHS[month - 1].toLowerCase()}`,
      tableHeader: "Do końca",
      tablePoints: Array.from({ length: YEAR_MONTHS }, (_, i) => i + 1),
      tableLabel: (month) => MONTHS_SHORT[month - 1],
      noData: `Brak wydatków w latach ${summaryYear - 1} i ${summaryYear}`,
    };
  }
  const month = selectedMonth();
  const previousMonth = addMonths(month, -1);
  const ongoing = isCurrentMonth(month);
  const lastPoint = ongoing ? today.getDate() : daysInMonth(month);
  const previousLastPoint = daysInMonth(previousMonth);
  const lastX = Math.max(daysInMonth(month), previousLastPoint);
  const tablePoints = [];
  for (let day = 5; day < lastX; day += 5) tablePoints.push(day);
  tablePoints.push(lastX);
  return {
    ongoing,
    unit: "miesiąc",
    lastPoint,
    previousLastPoint,
    lastX,
    current: cumulativeByDay(month, lastPoint),
    previous: cumulativeByDay(previousMonth, previousLastPoint),
    currentName: MONTHS[month.getMonth()],
    previousName: MONTHS[previousMonth.getMonth()],
    ticks: [1, 10, 20, lastX],
    tickLabel: (day) => String(day),
    pointTitle: (day) => `Do ${day}. dnia miesiąca`,
    tableHeader: "Do dnia",
    tablePoints,
    tableLabel: (day) => String(day),
    noData: "Brak wydatków w tym i poprzednim miesiącu",
  };
}

function paceHeadline(current, previous, ongoing, unit) {
  const verb = ongoing ? "są" : "były";
  const when = ongoing ? `niż o tej porze ${unit} temu` : `niż ${unit} wcześniej`;
  const inPeriod = unit === "rok" ? "W tym roku" : "W tym miesiącu";
  if (previous === 0) return `${ongoing ? `${inPeriod} wydano już` : `${inPeriod} wydano`} ${formatMoney(current)}`;
  if (current === previous) return `Wydatki ${verb} takie same ${when}`;
  if (current >= previous * 2) {
    const times = String(Math.round((current / previous) * 10) / 10).replace(".", ",");
    return `Wydatki ${verb} ${times} razy wyższe ${when}`;
  }
  const percent = Math.max(1, Math.round((Math.abs(current - previous) / previous) * 100));
  return `Wydatki ${verb} o ${percent}% ${current < previous ? "niższe" : "wyższe"} ${when}`;
}

function renderPaceChart() {
  const series = paceSeries();
  const { current, previous, lastPoint, previousLastPoint, lastX, currentName, previousName } = series;
  const hasData = current[lastPoint] + previous[previousLastPoint] > 0;

  $("pace-headline").textContent = hasData
    ? paceHeadline(current[lastPoint], previous[Math.min(lastPoint, previousLastPoint)], series.ongoing, series.unit)
    : series.noData;
  $("pace-legend").hidden = !hasData;
  $("pace-details").hidden = !hasData;
  paceClear = null;
  if (!hasData) {
    $("pace-chart").replaceChildren();
    return;
  }

  renderLegend("pace-legend", [
    { label: currentName, className: "key-line-expense" },
    { label: previousName, className: "key-line-muted" },
  ]);

  const plot = plotArea("pace-chart", { left: 46, right: 10, top: 12, bottom: 24 });
  const maxValue = niceMax(Math.max(current[lastPoint], previous[previousLastPoint]) / 100);
  const y = drawGrid(plot, maxValue);
  const x = (point) => plot.left + ((point - 1) / (lastX - 1)) * (plot.right - plot.left);

  const linePath = (values, end) => {
    let d = "";
    for (let point = 1; point <= end; point++) d += `${point === 1 ? "M" : "L"}${x(point)} ${y(values[point] / 100)}`;
    return d;
  };

  // Delikatna plazmowa poświata pod linią wybranego okresu.
  const defs = svgElement("defs", {}, plot.svg);
  const gradient = svgElement("linearGradient", { id: "pace-wash", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svgElement("stop", { offset: "0%", "stop-color": "var(--chart-expense)", "stop-opacity": 0.28 }, gradient);
  svgElement("stop", { offset: "100%", "stop-color": "var(--chart-expense)", "stop-opacity": 0 }, gradient);

  svgElement("path", { d: linePath(previous, previousLastPoint), class: "chart-line chart-line-muted" }, plot.svg);
  svgElement("path", {
    d: `${linePath(current, lastPoint)}L${x(lastPoint)} ${plot.bottom}L${x(1)} ${plot.bottom}Z`,
    fill: "url(#pace-wash)",
    class: "chart-wash",
  }, plot.svg);
  svgElement("path", { d: linePath(current, lastPoint), class: "chart-line chart-line-expense" }, plot.svg);
  svgElement("circle", {
    cx: x(lastPoint), cy: y(current[lastPoint] / 100), r: 5, class: "chart-end-dot",
  }, plot.svg);

  for (const point of series.ticks) {
    const label = svgElement("text", {
      x: x(point),
      y: CHART_HEIGHT - 7,
      "text-anchor": point === 1 ? "start" : point === lastX ? "end" : "middle",
      class: "chart-tick",
    }, plot.svg);
    label.textContent = series.tickLabel(point);
  }

  // Pionowa linia podąża za palcem i pokazuje wartości obu okresów w tym samym punkcie.
  const crosshair = svgElement("line", {
    y1: plot.top, y2: plot.bottom, class: "chart-crosshair", visibility: "hidden",
  }, plot.svg);
  const markerPrevious = svgElement("circle", { r: 4, class: "chart-marker-muted", visibility: "hidden" }, plot.svg);
  const markerCurrent = svgElement("circle", { r: 4, class: "chart-marker-expense", visibility: "hidden" }, plot.svg);

  const hit = svgElement("rect", {
    x: plot.left,
    y: 0,
    width: plot.right - plot.left,
    height: CHART_HEIGHT,
    class: "chart-hit chart-hit-scrub",
    tabindex: 0,
    role: "img",
    "data-chart-hit": "true",
    "aria-label": `${$("pace-headline").textContent}. Strzałki w lewo i w prawo zmieniają punkt na wykresie.`,
  }, plot.svg);

  let focusedPoint = lastPoint;
  const showPoint = (point, clientX, clientY) => {
    focusedPoint = point;
    const rows = [];
    crosshair.setAttribute("x1", x(point));
    crosshair.setAttribute("x2", x(point));
    crosshair.setAttribute("visibility", "visible");
    if (point <= lastPoint) {
      markerCurrent.setAttribute("cx", x(point));
      markerCurrent.setAttribute("cy", y(current[point] / 100));
      markerCurrent.setAttribute("visibility", "visible");
      rows.push({ value: formatMoney(current[point]), label: currentName.toLowerCase(), className: "key-line-expense" });
    } else {
      markerCurrent.setAttribute("visibility", "hidden");
    }
    if (point <= previousLastPoint) {
      markerPrevious.setAttribute("cx", x(point));
      markerPrevious.setAttribute("cy", y(previous[point] / 100));
      markerPrevious.setAttribute("visibility", "visible");
      rows.push({ value: formatMoney(previous[point]), label: previousName.toLowerCase(), className: "key-line-muted" });
    } else {
      markerPrevious.setAttribute("visibility", "hidden");
    }
    showChartTooltip(series.pointTitle(point), rows, clientX, clientY);
  };
  const clearPoint = () => {
    for (const mark of [crosshair, markerCurrent, markerPrevious]) mark.setAttribute("visibility", "hidden");
    hideChartTooltip();
  };
  const pointFromEvent = (event) => {
    const box = plot.svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left - plot.left) / (plot.right - plot.left);
    return Math.max(1, Math.min(lastX, Math.round(ratio * (lastX - 1)) + 1));
  };
  const onPointer = (event) => showPoint(pointFromEvent(event), event.clientX, event.clientY);
  hit.addEventListener("pointerdown", onPointer);
  hit.addEventListener("pointermove", onPointer);
  hit.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") clearPoint();
  });
  const showFocused = () => {
    const box = plot.svg.getBoundingClientRect();
    showPoint(focusedPoint, box.left + x(focusedPoint), box.top + 30);
  };
  hit.addEventListener("focus", showFocused);
  hit.addEventListener("blur", clearPoint);
  hit.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    focusedPoint = Math.max(1, Math.min(lastX, focusedPoint + (event.key === "ArrowLeft" ? -1 : 1)));
    showFocused();
  });
  paceClear = clearPoint;

  renderChartTable("pace-table", [series.tableHeader, currentName, previousName], series.tablePoints.map((point) => [
    series.tableLabel(point),
    point <= lastPoint ? formatNumber(current[point]) : "–",
    point <= previousLastPoint ? formatNumber(previous[point]) : "–",
  ]));
}

let paceClear = null;

// --- Wykres 3: na co idą pieniądze ---

function renderWhereChart() {
  const prefix = summaryMode === "year" ? String(summaryYear) : monthKey(selectedMonth());
  const transactions = transactionsInMonth("expense", prefix);
  const total = sumOf(transactions);
  const box = $("where-chart");
  box.replaceChildren();

  if (total === 0) {
    $("where-headline").textContent = "Brak wydatków w tym okresie";
    return;
  }

  const totals = new Map();
  for (const transaction of transactions) {
    totals.set(transaction.category, (totals.get(transaction.category) || 0) + transaction.grosze);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, CHART_TOP_CATEGORIES);
  const rest = ranked.slice(CHART_TOP_CATEGORIES).reduce((sum, [, value]) => sum + value, 0);

  const share = (value) => Math.round((value / total) * 100);
  $("where-headline").textContent = `Najwięcej idzie na: ${top[0][0]} (${share(top[0][1])}%)`;

  const addRow = (name, value, isRest) => {
    const row = element("div", "where-row");
    const head = element("div", "where-head");
    if (isRest) head.append(element("span", "avatar", "…"));
    else head.append(avatar(name));
    const percent = element("span", "where-percent", `${share(value)}%`);
    head.append(element("span", "where-name", name), percent, element("span", "where-value", formatMoney(value)));
    const track = element("div", "where-track");
    const fill = element("span", isRest ? "where-fill where-fill-rest" : "where-fill");
    fill.style.width = `${Math.max(1, (value / total) * 100)}%`;
    track.append(fill);
    row.append(head, track);
    box.append(row);
  };
  for (const [name, value] of top) addRow(name, value, false);
  if (rest > 0) addRow("Pozostałe", rest, true);
}

// --- Całość zakładki ---

function renderCharts() {
  hideChartTooltip();
  renderPeriodControls();
  $("charts-title").textContent = summaryMode === "year"
    ? `Rok ${summaryYear}`
    : `${MONTHS[summaryMonth]} ${summaryYear}`;
  renderFlowChart();
  renderPaceChart();
  renderWhereChart();
}

function chartsTabVisible() {
  return !$("tab-wykresy").hidden;
}

// Stuknięcie poza wykresem albo przewinięcie chowa dymek.
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest && event.target.closest("[data-chart-hit]")) return;
  if (paceClear) paceClear();
  hideChartTooltip();
});
window.addEventListener("scroll", () => {
  if (paceClear) paceClear();
  hideChartTooltip();
}, { passive: true });
window.addEventListener("resize", () => {
  if (chartsTabVisible()) renderCharts();
});

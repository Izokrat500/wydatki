// --- Zakładka Kalkulatory: wynik liczy się na bieżąco, bez przycisku „Oblicz” ---

const BELKA_TAX = 0.19;
const RANGE_MAX = 1000; // suwak ma stałą skalę, a kwotę wylicza z progów pola
const CALC_MAX_RATE = 30;

const AMOUNT_LIMIT = 99999999;
const STOPS_SAVINGS = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
const STOPS_MONTHLY = [0, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
const STOPS_LOAN = [5000, 50000, 100000, 250000, 500000, 1000000, 2000000];
const STOPS_ONE_OFF = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000];

const FIELD_RATE = { key: "rate", label: "calc.rate", unit: "%", stops: [0, 20], step: 0.05, limit: CALC_MAX_RATE };

const CALC_DEFAULTS = {
  compound: { initial: 10000, monthly: 500, rate: 6, years: 20, perYear: 12, tax: true },
  inflation: { amount: 10000, inflation: 3.5, rate: 0, years: 10 },
  loan: { amount: 300000, rate: 7.5, years: 25, type: "equal" },
  overpay: { balance: 300000, rate: 7.5, installments: 300, monthly: 500, oneOff: 0, mode: "shorter" },
};

const CALC_ICONS = {
  compound: "M4 17l5-5 4 4 7-8M15 8h5v5",
  inflation: "M4 7l5 5 4-4 7 8M15 16h5v-5",
  loan: "M4 11l8-7 8 7M6 10v10h12V10M10 20v-6h4v6",
  overpay: "M13 3L5 14h6l-1 7 8-11h-6l1-7z",
};

let calcState = null;
let calcOpen = null; // otwarty kalkulator albo null, gdy widać listę
let calcChartClear = null;
let calcLastWidth = 0;
const calcTablesOpen = new Set(); // rozwinięte tabele przetrwają zmianę suwaka

// --- Rachunki ---

function loanPayment(principal, monthlyRate, months) {
  if (months <= 0) return 0;
  return monthlyRate === 0 ? principal / months : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

function toMonths(years) {
  return Math.max(1, Math.round(years * 12));
}

function compoundResult({ initial, monthly, rate, years, perYear, tax }) {
  const months = toMonths(years);
  const monthlyRate = rate / 100 / 12;
  const capitalizeEvery = 12 / perYear;
  let balance = initial;
  let accrued = 0;
  let paid = initial;
  const points = [{ year: 0, paid, gain: 0 }];
  for (let month = 1; month <= months; month++) {
    accrued += balance * monthlyRate;
    if (month % capitalizeEvery === 0) {
      balance += accrued;
      accrued = 0;
    }
    balance += monthly;
    paid += monthly;
    if (month % 12 === 0 || month === months) points.push({ year: month / 12, paid, gain: balance + accrued - paid });
  }
  balance += accrued;
  const gain = balance - paid;
  const taxAmount = tax ? gain * BELKA_TAX : 0;
  return { paid, gain, taxAmount, netGain: gain - taxAmount, final: balance - taxAmount, points };
}

// Wartość realna to kwota na koncie wyrażona w dzisiejszych cenach.
function inflationResult({ amount, inflation, rate, years }) {
  const growth = (year) => (1 + rate / 100) ** year;
  const prices = (year) => (1 + inflation / 100) ** year;
  const whole = Math.ceil(years);
  const labels = Array.from({ length: whole + 1 }, (_, i) => Math.min(i, years));
  return {
    nominal: amount * growth(years),
    real: (amount * growth(years)) / prices(years),
    needed: amount * prices(years),
    pricesUp: (prices(years) - 1) * 100,
    labels,
    nominals: labels.map((year) => amount * growth(year)),
    reals: labels.map((year) => (amount * growth(year)) / prices(year)),
  };
}

function loanSchedule({ amount, rate, years, type }) {
  const months = toMonths(years);
  const monthlyRate = rate / 100 / 12;
  const equalPayment = loanPayment(amount, monthlyRate, months);
  let balance = amount;
  let totalInterest = 0;
  let first = 0;
  let last = 0;
  const yearly = [];
  for (let month = 1; month <= months; month++) {
    const interest = balance * monthlyRate;
    const capital = type === "equal" ? equalPayment - interest : amount / months;
    balance = Math.max(balance - capital, 0);
    totalInterest += interest;
    if (month === 1) first = capital + interest;
    last = capital + interest;
    const yearIndex = Math.ceil(month / 12) - 1;
    yearly[yearIndex] = yearly[yearIndex] || { year: yearIndex + 1, capital: 0, interest: 0, balance: 0 };
    yearly[yearIndex].capital += capital;
    yearly[yearIndex].interest += interest;
    yearly[yearIndex].balance = balance;
  }
  return { first, last, totalInterest, total: amount + totalInterest, yearly };
}

function overpaySimulation(startBalance, monthlyRate, months, monthly, oneOff, mode) {
  let balance = Math.max(startBalance - oneOff, 0);
  let payment = loanPayment(startBalance, monthlyRate, months);
  let interestSum = 0;
  let paidMonths = 0;
  let paymentAfterYear = 0;
  if (mode === "lower") payment = loanPayment(balance, monthlyRate, months);
  const balances = [balance];
  while (balance > 0.005 && paidMonths < months) {
    if (mode === "lower") payment = loanPayment(balance, monthlyRate, months - paidMonths);
    if (paidMonths === 12) paymentAfterYear = payment;
    const interest = balance * monthlyRate;
    interestSum += interest;
    balance = Math.max(balance - (payment - interest), 0);
    balance -= Math.min(monthly, balance);
    paidMonths += 1;
    balances.push(balance);
  }
  return { interest: interestSum, months: paidMonths, lastPayment: paidMonths ? payment : 0, paymentAfterYear, balances };
}

// --- Formatowanie ---

function calcNumber(value, digits = 0) {
  return value.toLocaleString(numberLocale(), { maximumFractionDigits: digits });
}

function moneyWhole(pln) {
  return `${calcNumber(Math.round(pln))} PLN`;
}

function moneyExact(pln) {
  return formatMoney(Math.round(pln * 100));
}

function yearsWord(years) {
  if (language !== "pl") return years === 1 ? "year" : "years";
  if (years === 1) return "rok";
  const lastDigit = years % 10;
  const teens = years % 100 >= 12 && years % 100 <= 14;
  return Number.isInteger(years) && lastDigit >= 2 && lastDigit <= 4 && !teens ? "lata" : "lat";
}

function installmentsWord(count) {
  if (language !== "pl") return count === 1 ? "payment" : "payments";
  if (count === 1) return "rata";
  const lastDigit = count % 10;
  const teens = count % 100 >= 12 && count % 100 <= 14;
  return Number.isInteger(count) && lastDigit >= 2 && lastDigit <= 4 && !teens ? "raty" : "rat";
}

function yearsText(years) {
  return `${calcNumber(years, 1)} ${yearsWord(years)}`;
}

function durationText(months) {
  if (months <= 0) return t("calc.immediately");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return t("calc.monthsShort", { months: rest });
  if (rest === 0) return yearsText(years);
  return t("calc.yearsAndMonths", { years: yearsText(years), months: rest });
}

function afterYearsText(years) {
  return years === 1 ? t("calc.afterOneYear") : t("calc.afterYears", { years: calcNumber(years, 1) });
}

// --- Suwak: progi dają dokładność przy małych kwotach i zasięg przy dużych ---

function valueToPosition(field, value) {
  const { stops } = field;
  if (value <= stops[0]) return 0;
  if (value >= stops[stops.length - 1]) return RANGE_MAX;
  const index = stops.findIndex((stop, i) => value >= stop && value < stops[i + 1]);
  const inSegment = (value - stops[index]) / (stops[index + 1] - stops[index]);
  return ((index + inSegment) / (stops.length - 1)) * RANGE_MAX;
}

function positionToValue(field, position) {
  const { stops } = field;
  if (position <= 0) return stops[0];
  if (position >= RANGE_MAX) return stops[stops.length - 1];
  const scaled = (position / RANGE_MAX) * (stops.length - 1);
  const index = Math.floor(scaled);
  const raw = stops[index] + (scaled - index) * (stops[index + 1] - stops[index]);
  const step = field.step || 10 ** Math.floor(Math.log10(Math.max(raw, 1))) / 20;
  return Number((Math.round(raw / step) * step).toFixed(2));
}

function parseCalcValue(text) {
  const value = parseFloat(text.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function fieldUnit(field, value) {
  if (field.unit === "installments") return installmentsWord(value);
  return field.unit === "years" ? yearsWord(value) : field.unit;
}

function fieldRow(calc, field) {
  const values = calcState[calc];
  const row = element("div", "calc-field");
  const head = element("label", "calc-field-head");
  const box = element("span", "calc-input");
  const input = element("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.maxLength = 12;
  const unit = element("span", "calc-unit");
  box.append(input, unit);
  head.append(element("span", "calc-label", t(field.label)), box);
  const range = element("input", "calc-range");
  range.type = "range";
  range.min = "0";
  range.max = String(RANGE_MAX);
  range.setAttribute("aria-label", t(field.label));

  const showText = () => { input.value = calcNumber(values[field.key], 2); };
  const sync = () => {
    const position = valueToPosition(field, values[field.key]);
    range.value = String(position);
    range.style.setProperty("--fill", `${position / (RANGE_MAX / 100)}%`);
    unit.textContent = fieldUnit(field, values[field.key]);
  };
  range.addEventListener("input", () => {
    values[field.key] = positionToValue(field, Number(range.value));
    showText();
    sync();
    calcChanged();
  });
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^\d.,\s]/g, "");
    values[field.key] = Math.min(parseCalcValue(input.value), field.limit);
    sync();
    calcChanged();
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", showText);

  showText();
  sync();
  row.append(head, range);
  return row;
}

function segmentedRow(calc, key, label, options) {
  const values = calcState[calc];
  const row = element("div", "calc-field");
  row.append(element("span", "calc-label", t(label)));
  const group = element("div", "segmented calc-segmented");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t(label));
  const hint = element("p", "calc-hint");
  const buttons = options.map((option) => {
    const button = element("button", "", t(option.label));
    button.type = "button";
    button.addEventListener("click", () => {
      values[key] = option.value;
      sync();
      calcChanged();
    });
    group.append(button);
    return button;
  });
  const sync = () => {
    const active = options.find((option) => option.value === values[key]);
    options.forEach((option, index) => buttons[index].setAttribute("aria-pressed", String(option === active)));
    hint.textContent = active.hint ? t(active.hint) : "";
    hint.hidden = !active.hint;
  };
  sync();
  row.append(group, hint);
  return row;
}

function switchRow(calc, key, label, hintKey) {
  const values = calcState[calc];
  const button = element("button", "calc-switch");
  button.type = "button";
  button.setAttribute("role", "switch");
  const text = element("span", "calc-switch-text");
  text.append(element("span", "calc-label", t(label)), element("span", "calc-hint", t(hintKey)));
  button.append(text, element("span", "calc-switch-track"));
  button.setAttribute("aria-checked", String(values[key]));
  button.addEventListener("click", () => {
    values[key] = !values[key];
    button.setAttribute("aria-checked", String(values[key]));
    calcChanged();
  });
  return button;
}

// --- Części wyniku ---

function setCalcHero(label, value, sentence, unit = "PLN") {
  const hero = $("calc-hero");
  const number = element("strong", "", value);
  if (value.length > 11) number.style.fontSize = `${Math.max(1.25, (2.75 * 11) / value.length)}rem`;
  const line = element("div", "total-value");
  line.append(number, element("span", "currency", unit));
  hero.replaceChildren(element("span", "total-label", label), line, element("p", "calc-sentence", sentence));
}

function calcRows(rows) {
  const box = element("div", "calc-rows");
  for (const [label, value, strong] of rows) {
    const row = element("div", strong ? "calc-row strong" : "calc-row");
    row.append(element("span", "", label), element("span", "calc-row-value", value));
    box.append(row);
  }
  return box;
}

// Pasek proporcji z legendą, żeby kolor nigdy nie był jedyną informacją.
function calcMeter(parts) {
  const total = parts.reduce((sum, part) => sum + Math.max(part.value, 0), 0);
  const bar = element("div", "calc-meter");
  const legend = element("div", "chart-legend calc-meter-legend");
  for (const part of parts) {
    const share = total > 0 ? (Math.max(part.value, 0) / total) * 100 : 0;
    const segment = element("span", `calc-meter-part ${part.className}`);
    segment.style.flexGrow = String(share);
    bar.append(segment);
    const item = element("span", "legend-item");
    item.append(element("span", `legend-key ${part.className}`), element("span", "", `${part.label} ${calcNumber(share)}%`));
    legend.append(item);
  }
  return [bar, legend];
}

function calcCard(...children) {
  const card = element("article", "card calc-card");
  card.append(...children);
  return card;
}

function calcTable(calc, summary, headers, rows) {
  const details = element("details", "chart-details");
  details.open = calcTablesOpen.has(calc);
  details.append(element("summary", "", summary));
  const table = element("table", "chart-table");
  const head = element("tr");
  for (const header of headers) head.append(element("th", "", header));
  table.append(head);
  for (const cells of rows) {
    const row = element("tr");
    for (const cell of cells) row.append(element("td", "", cell));
    table.append(row);
  }
  details.append(table);
  details.addEventListener("toggle", () => {
    if (details.open) calcTablesOpen.add(calc);
    else calcTablesOpen.delete(calc);
  });
  return details;
}

// Wykres w czasie: skumulowane pola albo osobne linie, z dymkiem pod palcem.
function drawCalcChart({ stacked, series, labels, title }) {
  const plot = plotArea("calc-plot", { top: 10, right: 10, bottom: 24, left: 54 });
  const count = labels.length;
  const x = (index) => plot.left + (count > 1 ? ((plot.right - plot.left) * index) / (count - 1) : 0);
  const tops = series.map((_, level) => labels.map((__, i) => (stacked ? series.slice(0, level + 1).reduce((sum, item) => sum + item.values[i], 0) : series[level].values[i])));
  const max = niceMax(Math.max(...tops.flat()));
  const y = drawGrid(plot, max);

  series.forEach((item, level) => {
    const line = tops[level].map((value, i) => `${x(i)},${y(value)}`);
    const floor = stacked && level > 0 ? tops[level - 1] : labels.map(() => 0);
    if (item.area) {
      const lower = floor.map((value, i) => `${x(i)},${y(value)}`).reverse();
      svgElement("path", { d: `M${line.join("L")}L${lower.join("L")}Z`, class: `calc-area ${item.area}` }, plot.svg);
    }
    svgElement("path", { d: `M${line.join("L")}`, class: `chart-line ${item.line}` }, plot.svg);
  });

  const tickIndexes = count > 2 ? [0, Math.round((count - 1) / 2), count - 1] : [0, count - 1];
  tickIndexes.forEach((index, position) => {
    const anchor = position === 0 ? "start" : position === tickIndexes.length - 1 ? "end" : "middle";
    const tick = svgElement("text", { x: x(index), y: plot.bottom + 17, "text-anchor": anchor, class: "chart-tick" }, plot.svg);
    tick.textContent = labels[index] === 0 ? t("calc.now") : yearsText(labels[index]);
  });

  const crosshair = svgElement("line", { y1: plot.top, y2: plot.bottom, class: "chart-crosshair", visibility: "hidden" }, plot.svg);
  const markers = series.map((item) => svgElement("circle", { r: 4.5, class: `calc-marker ${item.marker}`, visibility: "hidden" }, plot.svg));
  const hit = svgElement("rect", {
    x: plot.left - 8,
    y: plot.top,
    width: plot.right - plot.left + 16,
    height: plot.bottom - plot.top + 20,
    class: "chart-hit chart-hit-scrub",
    "data-chart-hit": "true",
    "aria-label": title,
  }, plot.svg);

  const onPointer = (event) => {
    const box = plot.svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left - plot.left) / (plot.right - plot.left);
    const index = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
    crosshair.setAttribute("x1", x(index));
    crosshair.setAttribute("x2", x(index));
    crosshair.setAttribute("visibility", "visible");
    markers.forEach((marker, level) => {
      marker.setAttribute("cx", x(index));
      marker.setAttribute("cy", y(tops[level][index]));
      marker.setAttribute("visibility", "visible");
    });
    const rows = series.map((item) => ({ value: moneyWhole(item.values[index]), label: item.label, className: item.key })).reverse();
    showChartTooltip(labels[index] === 0 ? t("calc.now") : yearsText(labels[index]), rows, event.clientX, event.clientY);
  };
  hit.addEventListener("pointerdown", onPointer);
  hit.addEventListener("pointermove", onPointer);
  hit.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && calcChartClear) calcChartClear();
  });
  calcChartClear = () => {
    crosshair.setAttribute("visibility", "hidden");
    for (const marker of markers) marker.setAttribute("visibility", "hidden");
    hideChartTooltip();
  };
}

function chartBlock(question, headline, series) {
  const plot = element("div", "chart-plot");
  plot.id = "calc-plot";
  const legend = element("div", "chart-legend");
  for (const item of series) {
    const entry = element("span", "legend-item");
    entry.append(element("span", `legend-key ${item.key}`), element("span", "", item.label));
    legend.append(entry);
  }
  return [element("h2", "chart-question", question), element("p", "chart-headline", headline), legend, plot];
}

// --- Procent składany ---

function updateCompound() {
  const values = calcState.compound;
  const result = compoundResult(values);
  setCalcHero(
    t("calc.compound.hero", { after: afterYearsText(values.years) }),
    calcNumber(Math.round(result.final)),
    t("calc.compound.sentence", { paid: moneyWhole(result.paid), gain: moneyWhole(result.netGain) }),
  );

  const rows = [[t("calc.compound.paid"), moneyWhole(result.paid)], [t(values.tax ? "calc.compound.gainBefore" : "calc.compound.gain"), moneyWhole(result.gain)]];
  if (values.tax) rows.push([t("calc.compound.tax"), `−${moneyWhole(result.taxAmount)}`]);
  rows.push([t("calc.compound.final"), moneyWhole(result.final), true]);

  const series = [
    { label: t("calc.compound.paid"), values: result.points.map((p) => p.paid), line: "calc-line-teal", area: "calc-area-teal", marker: "calc-marker-teal", key: "key-income" },
    { label: t(values.tax ? "calc.compound.gainBefore" : "calc.compound.gain"), values: result.points.map((p) => p.gain), line: "chart-line-expense", area: "calc-area-violet", marker: "chart-marker-expense", key: "key-expense" },
  ];
  const overtakes = result.points.find((p) => p.gain * (values.tax ? 1 - BELKA_TAX : 1) > p.paid); // zgodnie z zyskiem podanym wyżej
  const headline = overtakes && overtakes.year > 0
    ? t("calc.compound.overtakes", { after: afterYearsText(overtakes.year) })
    : t("calc.compound.share", { percent: calcNumber(result.final > 0 ? (result.netGain / result.final) * 100 : 0) });

  $("calc-details").replaceChildren(
    calcCard(...calcMeter([
      { value: result.paid, label: t("calc.compound.paid"), className: "key-income" },
      { value: result.netGain, label: t("calc.compound.gain"), className: "key-expense" },
    ]), calcRows(rows)),
    calcCard(
      ...chartBlock(t("calc.compound.chart"), headline, series),
      calcTable("compound", t("calc.yearByYear"), [t("calc.yearHead"), t("calc.compound.paid"), t("calc.compound.gain")], result.points.slice(1).map((p) => [
        calcNumber(p.year, 1), calcNumber(Math.round(p.paid)), calcNumber(Math.round(p.gain)),
      ])),
    ),
  );
  drawCalcChart({ stacked: true, series, labels: result.points.map((p) => p.year), title: headline });
}

// --- Inflacja ---

function updateInflation() {
  const values = calcState.inflation;
  if (values.amount <= 0) return showCalcNeedsAmount("calc.inflation.needAmount");
  const result = inflationResult(values);
  const change = (result.real / values.amount - 1) * 100;
  const percent = calcNumber(Math.abs(change), 1);
  const nominal = moneyWhole(result.nominal);
  let sentence = t("calc.inflation.same");
  if (Math.abs(change) >= 0.05 && change < 0) sentence = t(values.rate > 0 ? "calc.inflation.lossWithRate" : "calc.inflation.loss", { percent, nominal });
  if (Math.abs(change) >= 0.05 && change > 0) sentence = t("calc.inflation.gainWithRate", { percent, nominal });
  setCalcHero(
    t("calc.inflation.hero", { after: afterYearsText(values.years), amount: moneyWhole(values.amount) }),
    calcNumber(Math.round(result.real)),
    sentence,
  );

  const difference = result.real - values.amount;
  const rows = [[t("calc.inflation.today"), moneyWhole(values.amount)]];
  if (values.rate > 0) rows.push([t("calc.inflation.onAccount"), nominal]);
  rows.push(
    [t("calc.inflation.pricesUp"), `+${calcNumber(result.pricesUp, 1)}%`],
    [t("calc.inflation.difference"), `${difference < 0 ? "−" : "+"}${moneyWhole(Math.abs(difference))}`],
    [t("calc.inflation.real"), moneyWhole(result.real), true],
  );
  const meter = result.real < values.amount ? calcMeter([
    { value: result.real, label: t("calc.inflation.kept"), className: "key-income" },
    { value: values.amount - result.real, label: t("calc.inflation.lost"), className: "key-expense" },
  ]) : [];

  const series = [
    { label: t("calc.inflation.onAccount"), values: result.nominals, line: "chart-line-muted", marker: "chart-marker-muted", key: "key-line-muted" },
    { label: t("calc.inflation.real"), values: result.reals, line: "chart-line-expense", area: "calc-area-violet", marker: "chart-marker-expense", key: "key-line-expense" },
  ];
  const headline = t("calc.inflation.needed", { needed: moneyWhole(result.needed) });
  $("calc-details").replaceChildren(
    calcCard(...meter, calcRows(rows)),
    calcCard(
      ...chartBlock(t("calc.inflation.chart"), headline, series),
      calcTable("inflation", t("calc.yearByYear"), [t("calc.yearHead"), t("calc.inflation.onAccount"), t("calc.inflation.real")], result.labels.slice(1).map((year, index) => [
        calcNumber(year, 1), calcNumber(Math.round(result.nominals[index + 1])), calcNumber(Math.round(result.reals[index + 1])),
      ])),
    ),
  );
  drawCalcChart({ stacked: false, series, labels: result.labels, title: headline });
}

// --- Rata kredytu ---

function updateLoan() {
  const values = calcState.loan;
  if (values.amount <= 0) return showCalcNeedsAmount();
  const result = loanSchedule(values);
  const isEqual = values.type === "equal";
  const other = loanSchedule({ ...values, type: isEqual ? "decreasing" : "equal" });
  const higherRate = loanSchedule({ ...values, rate: values.rate + 1 });
  setCalcHero(
    t(isEqual ? "calc.loan.heroEqual" : "calc.loan.heroFirst"),
    formatNumber(Math.round(result.first * 100)),
    t(isEqual ? "calc.loan.sentence" : "calc.loan.sentenceLast", { total: moneyWhole(result.total), last: moneyExact(result.last) }),
  );

  const compare = values.rate > 0
    ? t(isEqual ? "calc.loan.compareDecreasing" : "calc.loan.compareEqual", { first: moneyExact(other.first), diff: moneyWhole(Math.abs(result.total - other.total)) })
    : "";
  const compareLine = element("p", "calc-hint calc-compare", compare);
  compareLine.hidden = !compare;
  const overpayLink = element("button", "btn-ghost pots-action", t("calc.loan.toOverpay"));
  overpayLink.type = "button";
  overpayLink.addEventListener("click", () => {
    Object.assign(calcState.overpay, { balance: values.amount, rate: values.rate, installments: toMonths(values.years) });
    openCalculator("overpay");
  });

  $("calc-details").replaceChildren(
    calcCard(...calcMeter([
      { value: values.amount, label: t("calc.loan.capital"), className: "key-income" },
      { value: result.totalInterest, label: t("calc.loan.interest"), className: "key-expense" },
    ]), calcRows([
      [t("calc.loan.amount"), moneyWhole(values.amount)],
      [t("calc.loan.interest"), moneyWhole(result.totalInterest)],
      [t("calc.loan.total"), moneyWhole(result.total), true],
      [t("calc.loan.rateUp"), `+${moneyExact(higherRate.first - result.first)}`],
    ]), compareLine),
    calcCard(
      element("h2", "chart-question", t("calc.loan.schedule")),
      calcTable("loan", t("calc.yearByYear"), [t("calc.yearHead"), t("calc.loan.capital"), t("calc.loan.interest"), t("calc.loan.left")], result.yearly.map((row) => [
        String(row.year), calcNumber(Math.round(row.capital)), calcNumber(Math.round(row.interest)), calcNumber(Math.round(row.balance)),
      ])),
    ),
    overpayLink,
  );
}

// --- Nadpłata kredytu ---

function overpayChoice(mode, title, saved, detail) {
  const button = element("button", "card calc-choice");
  button.type = "button";
  button.setAttribute("aria-pressed", String(calcState.overpay.mode === mode));
  button.append(element("span", "calc-choice-title", t(title)), element("strong", "calc-choice-value", moneyWhole(saved)), element("span", "calc-hint", detail));
  button.addEventListener("click", () => {
    calcState.overpay.mode = mode;
    calcChanged();
  });
  return button;
}

function updateOverpay() {
  const values = calcState.overpay;
  if (values.balance <= 0) return showCalcNeedsAmount();
  const months = Math.max(1, Math.round(values.installments));
  const monthlyRate = values.rate / 100 / 12;
  const simulate = (monthly, oneOff, mode) => overpaySimulation(values.balance, monthlyRate, months, monthly, oneOff, mode);
  const base = simulate(0, 0, "shorter");
  const shorter = simulate(values.monthly, values.oneOff, "shorter");
  const lower = simulate(values.monthly, values.oneOff, "lower");
  const chosen = values.mode === "lower" ? lower : shorter;
  const saved = base.interest - chosen.interest;
  const currentPayment = loanPayment(values.balance, monthlyRate, months);
  const hasOverpayment = values.monthly > 0 || values.oneOff > 0;

  // Przy stałej nadpłacie rata topnieje co miesiąc, więc pokazujemy ją po roku, a nie tuż przed końcem.
  const afterYear = values.monthly > 0 && lower.paymentAfterYear > 0;
  const newPayment = moneyExact(afterYear ? lower.paymentAfterYear : lower.lastPayment);
  const lowerDetail = t(afterYear ? "calc.overpay.lowerDetailYear" : "calc.overpay.lowerDetail", { payment: newPayment });
  const monthsSaved = base.months - shorter.months;
  const shorterDetail = monthsSaved > 0 ? t("calc.overpay.shorterDetail", { time: durationText(monthsSaved) }) : t("calc.overpay.sameTerm");
  let sentence = t("calc.overpay.enter");
  if (hasOverpayment && values.mode === "shorter") sentence = monthsSaved > 0 ? t("calc.overpay.sentenceShorter", { time: durationText(monthsSaved) }) : t("calc.overpay.sentenceSame");
  if (hasOverpayment && values.mode === "lower") {
    sentence = t(afterYear ? "calc.overpay.sentenceLowerEnd" : "calc.overpay.sentenceLower", { from: moneyExact(currentPayment), to: newPayment });
  }
  setCalcHero(t("calc.overpay.hero"), calcNumber(Math.round(saved)), sentence);

  const choices = $("calc-choices");
  choices.replaceChildren(
    overpayChoice("shorter", "calc.overpay.shorter", base.interest - shorter.interest, shorterDetail),
    overpayChoice("lower", "calc.overpay.lower", base.interest - lower.interest, lowerDetail),
  );

  const years = Math.ceil(months / 12);
  const labels = Array.from({ length: years + 1 }, (_, i) => Math.min(i, months / 12));
  const balanceAt = (simulation, year) => simulation.balances[Math.round(year * 12)] ?? 0;
  const series = [
    { label: t("calc.overpay.without"), values: labels.map((year) => balanceAt(base, year)), line: "chart-line-muted", marker: "chart-marker-muted", key: "key-line-muted" },
    { label: t("calc.overpay.with"), values: labels.map((year) => balanceAt(chosen, year)), line: "chart-line-expense", area: "calc-area-violet", marker: "chart-marker-expense", key: "key-line-expense" },
  ];

  const startPayment = values.mode === "lower" ? loanPayment(Math.max(values.balance - values.oneOff, 0), monthlyRate, months) : currentPayment;
  const monthlyRow = values.monthly > 0 ? [[t("calc.overpay.paidMonthly"), moneyExact(startPayment + values.monthly)]] : [];

  $("calc-details").replaceChildren(
    calcCard(calcRows([
      [t("calc.overpay.current"), moneyExact(currentPayment)],
      ...monthlyRow,
      [t("calc.overpay.interestWithout"), moneyWhole(base.interest)],
      [t("calc.overpay.interestWith"), moneyWhole(chosen.interest)],
      [t("calc.overpay.duration"), chosen.months > 0 ? `${chosen.months} ${installmentsWord(chosen.months)} · ${durationText(chosen.months)}` : durationText(0), true],
    ])),
    calcCard(
      ...chartBlock(t("calc.overpay.chart"), sentence, series),
      calcTable("overpay", t("calc.yearByYear"), [t("calc.yearHead"), t("calc.overpay.without"), t("calc.overpay.with")], labels.slice(1).map((year, index) => [
        calcNumber(year, 1), calcNumber(Math.round(series[0].values[index + 1])), calcNumber(Math.round(series[1].values[index + 1])),
      ])),
    ),
  );
  drawCalcChart({ stacked: false, series, labels, title: sentence });
}

function showCalcNeedsAmount(message = "calc.needAmount") {
  setCalcHero(t("calc.needAmountLabel"), "0", t(message));
  $("calc-details").replaceChildren();
  $("calc-choices").replaceChildren();
}

// --- Definicje ekranów ---

function calcScreens() {
  return {
    compound: {
      title: "calc.compound.title",
      question: "calc.compound.question",
      note: "calc.compound.note",
      update: updateCompound,
      controls: () => [
        fieldRow("compound", { key: "initial", label: "calc.compound.initial", unit: "PLN", stops: STOPS_SAVINGS, limit: AMOUNT_LIMIT }),
        fieldRow("compound", { key: "monthly", label: "calc.compound.monthly", unit: "PLN", stops: STOPS_MONTHLY, limit: AMOUNT_LIMIT }),
        fieldRow("compound", FIELD_RATE),
        fieldRow("compound", { key: "years", label: "calc.compound.years", unit: "years", stops: [1, 50], step: 1, limit: 80 }),
        segmentedRow("compound", "perYear", "calc.compound.perYear", [
          { value: 12, label: "calc.compound.monthlyCap" },
          { value: 1, label: "calc.compound.yearlyCap" },
        ]),
        switchRow("compound", "tax", "calc.compound.taxSwitch", "calc.compound.taxHint"),
      ],
    },
    inflation: {
      title: "calc.inflation.title",
      question: "calc.inflation.question",
      note: "calc.inflation.note",
      update: updateInflation,
      controls: () => [
        fieldRow("inflation", { key: "amount", label: "calc.inflation.amount", unit: "PLN", stops: STOPS_SAVINGS, limit: AMOUNT_LIMIT }),
        fieldRow("inflation", { key: "inflation", label: "calc.inflation.rateLabel", unit: "%", stops: [0, 20], step: 0.05, limit: CALC_MAX_RATE }),
        fieldRow("inflation", { key: "years", label: "calc.compound.years", unit: "years", stops: [1, 50], step: 1, limit: 80 }),
        fieldRow("inflation", { key: "rate", label: "calc.inflation.savingsRate", unit: "%", stops: [0, 20], step: 0.05, limit: CALC_MAX_RATE }),
      ],
    },
    loan: {
      title: "calc.loan.title",
      question: "calc.loan.question",
      note: "calc.loan.note",
      update: updateLoan,
      controls: () => [
        fieldRow("loan", { key: "amount", label: "calc.loan.amount", unit: "PLN", stops: STOPS_LOAN, limit: AMOUNT_LIMIT }),
        fieldRow("loan", FIELD_RATE),
        fieldRow("loan", { key: "years", label: "calc.loan.years", unit: "years", stops: [1, 35], step: 1, limit: 50 }),
        segmentedRow("loan", "type", "calc.loan.type", [
          { value: "equal", label: "calc.loan.equal", hint: "calc.loan.equalHint" },
          { value: "decreasing", label: "calc.loan.decreasing", hint: "calc.loan.decreasingHint" },
        ]),
      ],
    },
    overpay: {
      title: "calc.overpay.title",
      question: "calc.overpay.question",
      note: "calc.overpay.note",
      update: updateOverpay,
      controls: () => [
        fieldRow("overpay", { key: "balance", label: "calc.overpay.balance", unit: "PLN", stops: STOPS_LOAN, limit: AMOUNT_LIMIT }),
        fieldRow("overpay", FIELD_RATE),
        fieldRow("overpay", { key: "installments", label: "calc.overpay.installments", unit: "installments", stops: [1, 60, 120, 240, 360, 420], step: 1, limit: 600 }),
        fieldRow("overpay", { key: "monthly", label: "calc.overpay.monthly", unit: "PLN", stops: STOPS_MONTHLY, limit: AMOUNT_LIMIT }),
        fieldRow("overpay", { key: "oneOff", label: "calc.overpay.oneOff", unit: "PLN", stops: STOPS_ONE_OFF, limit: AMOUNT_LIMIT }),
      ],
    },
  };
}

// --- Widoki ---

function calcIcon(id) {
  const box = element("span", "calc-icon");
  const svg = svgElement("svg", { viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": "true" }, box);
  svgElement("path", { d: CALC_ICONS[id], fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
  return box;
}

function renderCalcHub() {
  const list = $("calc-list");
  list.replaceChildren();
  for (const [id, screen] of Object.entries(calcScreens())) {
    const tile = element("button", "card calc-tile");
    tile.type = "button";
    const text = element("span", "calc-tile-text");
    text.append(element("strong", "", t(screen.title)), element("span", "", t(screen.question)));
    tile.append(calcIcon(id), text, element("span", "calc-tile-arrow", "›"));
    tile.addEventListener("click", () => openCalculator(id));
    list.append(tile);
  }
}

function renderCalcView() {
  const screen = calcScreens()[calcOpen];
  const back = element("button", "calc-back", `‹ ${t("tab.calc")}`);
  back.type = "button";
  back.addEventListener("click", closeCalculator);
  const hero = element("div", "card calc-hero");
  hero.id = "calc-hero";
  hero.setAttribute("aria-live", "polite");
  const choices = element("div", "calc-choices");
  choices.id = "calc-choices";
  const controls = element("div", "card calc-card calc-controls");
  controls.append(...screen.controls());
  const details = element("div");
  details.id = "calc-details";
  $("calc-view").replaceChildren(back, element("h2", "calc-title", t(screen.title)), hero, choices, controls, details, element("p", "calc-note", t(screen.note)));
  screen.update();
}

function renderCalculators() {
  $("calc-hub").hidden = Boolean(calcOpen);
  $("calc-view").hidden = !calcOpen;
  if (calcOpen) renderCalcView();
  else renderCalcHub();
  calcLastWidth = window.innerWidth;
}

function openCalculator(id) {
  calcOpen = id;
  renderCalculators();
  window.scrollTo(0, 0);
}

function closeCalculator() {
  calcOpen = null;
  hideChartTooltip();
  renderCalculators();
  window.scrollTo(0, 0);
}

function calcChanged() {
  if (!calcOpen) return;
  writeLocal(STORAGE_KEY + ".calculators", JSON.stringify(calcState));
  hideChartTooltip();
  calcScreens()[calcOpen].update();
}

function loadCalcState() {
  let saved = {};
  try {
    saved = JSON.parse(readLocal(STORAGE_KEY + ".calculators")) || {};
  } catch {}
  // Wcześniej nadpłata pamiętała pozostałe lata zamiast liczby rat.
  if (saved.overpay && saved.overpay.installments === undefined && saved.overpay.years > 0) saved.overpay.installments = toMonths(saved.overpay.years);
  const state = {};
  for (const [calc, defaults] of Object.entries(CALC_DEFAULTS)) {
    state[calc] = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const value = saved[calc] && saved[calc][key];
      if (typeof value === typeof defaults[key] && (typeof value !== "number" || (Number.isFinite(value) && value >= 0))) state[calc][key] = value;
    }
  }
  return state;
}

function calcTabVisible() {
  return !$("tab-kalkulatory").hidden;
}

function setupCalculators() {
  calcState = loadCalcState();
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest && event.target.closest("[data-chart-hit]")) return;
    if (calcChartClear) calcChartClear();
  });
  // Klawiatura na Androidzie zmienia tylko wysokość, a pola nie mogą wtedy stracić fokusu.
  window.addEventListener("resize", () => {
    if (window.innerWidth === calcLastWidth || !calcTabVisible()) return;
    calcLastWidth = window.innerWidth;
    calcChanged();
  });
}

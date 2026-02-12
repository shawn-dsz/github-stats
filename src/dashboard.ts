#!/usr/bin/env -S node --import tsx
import { execSync } from 'node:child_process';
import chalk from 'chalk';

// ── Types ───────────────────────────────────────────────────────────────────

interface ContributionDay {
  date: string;
  contributionCount: number;
}

interface ContributionWeek {
  contributionDays: ContributionDay[];
}

interface CalendarData {
  totalContributions: number;
  weeks: ContributionWeek[];
}

interface GitHubData {
  login: string;
  calendar: CalendarData;
}

// ── Heatmap palette (matches GitHub) ────────────────────────────────────────

const HEATMAP_COLOURS = [
  [22, 27, 34],    // #161b22 - no contributions
  [14, 68, 41],    // #0e4429 - Q1
  [0, 109, 50],    // #006d32 - Q2
  [38, 166, 65],   // #26a641 - Q3
  [57, 211, 83],   // #39d353 - Q4
] as const;

const BAR_COLOUR = [38, 166, 65] as const; // green for bar chart

// ── Data fetching ───────────────────────────────────────────────────────────

function fetchContributions(): GitHubData {
  const query = `
    query {
      viewer {
        login
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = execSync(
      `gh api graphql -f query='${query.replace(/\n/g, ' ').replace(/'/g, "'\\''")}'`,
      { timeout: 10_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const json = JSON.parse(result);
    const viewer = json.data.viewer;

    return {
      login: viewer.login,
      calendar: viewer.contributionsCollection.contributionCalendar,
    };
  } catch {
    console.error(
      chalk.red('Failed to fetch GitHub data. Make sure `gh` is installed and authenticated.')
    );
    console.error(chalk.dim('Run `gh auth login` to set up the GitHub CLI.'));
    process.exit(1);
  }
}

// ── Data processing ─────────────────────────────────────────────────────────

function getAllDays(calendar: CalendarData): ContributionDay[] {
  return calendar.weeks.flatMap(w => w.contributionDays);
}

function calculateStreak(days: ContributionDay[]): number {
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  let startIdx = 0;

  // Skip today if zero (day is not over yet)
  const today = new Date().toISOString().slice(0, 10);
  if (sorted[0]?.date === today && sorted[0].contributionCount === 0) {
    startIdx = 1;
  }

  for (let i = startIdx; i < sorted.length; i++) {
    if (sorted[i].contributionCount > 0) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function calculateLongestStreak(days: ContributionDay[]): number {
  let longest = 0;
  let current = 0;

  for (const day of days) {
    if (day.contributionCount > 0) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }

  return longest;
}

function computeQuartiles(days: ContributionDay[]): number[] {
  const nonZero = days
    .map(d => d.contributionCount)
    .filter(c => c > 0)
    .sort((a, b) => a - b);

  if (nonZero.length === 0) return [1, 2, 3, 4];

  const q1 = nonZero[Math.floor(nonZero.length * 0.25)];
  const q2 = nonZero[Math.floor(nonZero.length * 0.50)];
  const q3 = nonZero[Math.floor(nonZero.length * 0.75)];

  return [q1, q2, q3];
}

function getHeatmapLevel(count: number, quartiles: number[]): number {
  if (count === 0) return 0;
  if (count <= quartiles[0]) return 1;
  if (count <= quartiles[1]) return 2;
  if (count <= quartiles[2]) return 3;
  return 4;
}

// ── Rendering helpers ───────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[date.getMonth()]}`;
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function padStart(str: string, len: number): string {
  return str.padStart(len);
}

// ── Render header ───────────────────────────────────────────────────────────

function renderHeader(login: string, totalContributions: number, width: number): void {
  const title = '  GitHub Contributions';
  const user = login;
  const gap = Math.max(1, width - title.length - user.length);

  console.log(chalk.bold.white(title) + ' '.repeat(gap) + chalk.dim(user));
  console.log(chalk.dim('  ' + '─'.repeat(width - 2)));
  console.log(
    chalk.white(`  ${formatNumber(totalContributions)} contributions in the last year`)
  );
  console.log();
}

// ── Render stats grid ───────────────────────────────────────────────────────

function renderStats(days: ContributionDay[], width: number): void {
  const allDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date().toISOString().slice(0, 10);
  const todayData = allDays.find(d => d.date === today);
  const todayCount = todayData?.contributionCount ?? 0;

  // This week: last 7 days
  const last7 = allDays.slice(-7);
  const weekCount = last7.reduce((sum, d) => sum + d.contributionCount, 0);

  // Best day
  const best = allDays.reduce((max, d) =>
    d.contributionCount > max.contributionCount ? d : max, allDays[0]);

  const currentStreak = calculateStreak(allDays);
  const longestStreak = calculateLongestStreak(allDays);

  // Averages (yearly)
  const totalDays = allDays.length;
  const total = allDays.reduce((sum, d) => sum + d.contributionCount, 0);
  const avgPerWeek = total / (totalDays / 7);
  const avgPerMonth = total / (totalDays / 30.44);
  const avgPerQuarter = total / (totalDays / 91.31);

  // Avg/day this week
  const weekDaysWithData = last7.filter(d => d.date <= today).length;
  const avgPerDayThisWeek = weekDaysWithData > 0 ? weekCount / weekDaysWithData : 0;

  // Avg/day this month
  const currentMonth = today.slice(0, 7); // "YYYY-MM"
  const thisMonthDays = allDays.filter(d => d.date.startsWith(currentMonth) && d.date <= today);
  const monthTotal = thisMonthDays.reduce((sum, d) => sum + d.contributionCount, 0);
  const avgPerDayThisMonth = thisMonthDays.length > 0 ? monthTotal / thisMonthDays.length : 0;

  // Avg/day this quarter
  const todayDate = new Date(today + 'T00:00:00');
  const quarterStartMonth = Math.floor(todayDate.getMonth() / 3) * 3;
  const quarterStart = new Date(todayDate.getFullYear(), quarterStartMonth, 1)
    .toISOString().slice(0, 10);
  const thisQuarterDays = allDays.filter(d => d.date >= quarterStart && d.date <= today);
  const quarterTotal = thisQuarterDays.reduce((sum, d) => sum + d.contributionCount, 0);
  const avgPerDayThisQuarter = thisQuarterDays.length > 0 ? quarterTotal / thisQuarterDays.length : 0;

  const labelWidth = 18;
  const valWidth = 16;
  const colWidth = labelWidth + valWidth;

  const rows = [
    ['  Today',     padStart(String(todayCount), valWidth),
     'Current streak', padStart(`${currentStreak} days`, valWidth)],
    ['  This week', padStart(String(weekCount), valWidth),
     'Longest streak',  padStart(`${longestStreak} days`, valWidth)],
    ['  Best day',  padStart(`${best.contributionCount} (${formatDate(best.date)})`, valWidth),
     'Avg/day (week)',    padStart(avgPerDayThisWeek.toFixed(1), valWidth)],
    ['  Avg/week',  padStart(avgPerWeek.toFixed(1), valWidth),
     'Avg/day (month)',   padStart(avgPerDayThisMonth.toFixed(1), valWidth)],
    ['  Avg/month', padStart(avgPerMonth.toFixed(1), valWidth),
     'Avg/day (quarter)', padStart(avgPerDayThisQuarter.toFixed(1), valWidth)],
    ['  Avg/quarter', padStart(avgPerQuarter.toFixed(1), valWidth),
     '',                  ''],
  ];

  for (const [lLabel, lVal, rLabel, rVal] of rows) {
    const left = chalk.dim(pad(lLabel, labelWidth)) + chalk.white(lVal);
    const right = chalk.dim(pad(rLabel, labelWidth)) + chalk.white(rVal);
    const gap = Math.max(2, width - colWidth * 2);
    console.log(left + ' '.repeat(gap) + right);
  }

  console.log(chalk.dim('  ' + '─'.repeat(width - 2)));
}

// ── Render bar chart (last 14 days) ─────────────────────────────────────────

function renderBarChart(days: ContributionDay[], width: number): void {
  console.log(chalk.bold.white('  Last 14 Days'));
  console.log();

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last14 = sorted.slice(-14);
  const maxCount = Math.max(...last14.map(d => d.contributionCount), 1);
  const labelWidth = 8; // "30 Jan  "
  const countWidth = 6; // "  123"
  const barMaxWidth = Math.max(20, width - labelWidth - countWidth - 4);

  for (const day of last14) {
    const label = pad(formatDate(day.date), labelWidth);
    const barLen = Math.round((day.contributionCount / maxCount) * barMaxWidth);
    const bar = '█'.repeat(barLen);
    const count = padStart(String(day.contributionCount), 4);

    console.log(
      chalk.dim(`  ${label}`) +
      chalk.rgb(...BAR_COLOUR)(bar) +
      chalk.white(` ${count}`)
    );
  }

  console.log(chalk.dim('  ' + '─'.repeat(width - 2)));
}

// ── Render heatmap ──────────────────────────────────────────────────────────

function renderHeatmap(calendar: CalendarData, width: number): void {
  console.log(chalk.bold.white('  Contribution Graph'));
  console.log();

  const weeks = calendar.weeks;
  const allDays = getAllDays(calendar);
  const quartiles = computeQuartiles(allDays);

  // Determine cell width based on terminal width
  const dayLabelWidth = 6; // "Mon  "
  const indent = 2;
  const available = width - indent - dayLabelWidth;
  const cellWidth = available >= weeks.length * 2 ? 2 : 1;
  const maxWeeks = Math.min(weeks.length, Math.floor(available / cellWidth));
  const displayWeeks = weeks.slice(weeks.length - maxWeeks);

  // Month labels
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Build month labels: place at the week column where each month starts
  const monthPositions: { col: number; label: string }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < displayWeeks.length; w++) {
    const firstDay = displayWeeks[w].contributionDays[0];
    if (firstDay) {
      const month = new Date(firstDay.date + 'T00:00:00').getMonth();
      if (month !== lastMonth) {
        monthPositions.push({ col: w * cellWidth, label: months[month] });
        lastMonth = month;
      }
    }
  }

  // Render month row, skipping labels that would overlap the previous one
  const chars: string[] = new Array(displayWeeks.length * cellWidth).fill(' ');
  let lastEnd = -1;

  for (const { col, label } of monthPositions) {
    // Require at least 1 space gap between labels for readability
    if (col > lastEnd && col + label.length <= chars.length) {
      for (let i = 0; i < label.length; i++) {
        chars[col + i] = label[i];
      }
      lastEnd = col + label.length;
    }
  }

  const monthRow = ' '.repeat(indent + dayLabelWidth) + chars.join('');

  console.log(chalk.dim(monthRow));

  // Day rows (Mon, Wed, Fri for compactness, or all 7 if space allows)
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rowIndices = available >= weeks.length * 2
    ? [0, 1, 2, 3, 4, 5, 6]
    : [1, 3, 5]; // Mon, Wed, Fri

  for (const dayIdx of rowIndices) {
    let row = ' '.repeat(indent) + pad(dayLabels[dayIdx], dayLabelWidth);

    for (const week of displayWeeks) {
      const day = week.contributionDays[dayIdx];
      if (day) {
        const level = getHeatmapLevel(day.contributionCount, quartiles);
        const colour = HEATMAP_COLOURS[level];
        row += chalk.bgRgb(colour[0], colour[1], colour[2])(' '.repeat(cellWidth));
      } else {
        row += ' '.repeat(cellWidth);
      }
    }

    console.log(row);
  }

  console.log();

  // Legend
  const legendIndent = ' '.repeat(indent + dayLabelWidth);
  let legend = legendIndent + chalk.dim('Less ');
  for (let i = 0; i < HEATMAP_COLOURS.length; i++) {
    const c = HEATMAP_COLOURS[i];
    legend += chalk.bgRgb(c[0], c[1], c[2])('  ');
    if (i < HEATMAP_COLOURS.length - 1) legend += ' ';
  }
  legend += chalk.dim(' More');
  console.log(legend);
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const termWidth = process.stdout.columns ?? 80;
  const width = Math.min(termWidth, 100);

  const data = fetchContributions();
  const allDays = getAllDays(data.calendar);

  console.log();
  renderHeader(data.login, data.calendar.totalContributions, width);
  renderStats(allDays, width);
  console.log();
  renderBarChart(allDays, width);
  console.log();
  renderHeatmap(data.calendar, width);
  console.log();
}

main();

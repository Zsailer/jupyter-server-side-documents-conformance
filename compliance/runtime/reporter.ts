import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { rowLines, rowOf, Row, Style, summaryLines } from './report';

/**
 * The reporter of the `rtc-conformance` command: a line per story as it finishes (skipped ones are only counted), a spinner
 * line for the story running now, and a summary. It is not for CI logs that want the full detail: use Playwright's own
 * reporters for that.
 */
export default class ConformanceReporter implements Reporter {
  private rows: Row[] = [];
  private started = Date.now();
  private style: Style = { color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR };
  private live = Boolean(process.stdout.isTTY);
  private timer?: NodeJS.Timeout;
  private frame = 0;
  private running = '';

  printsToStdio(): boolean {
    return true;
  }

  onTestBegin(test: TestCase): void {
    const id = test.title.split(' · ')[0];
    this.running = `${id}  ${test.title.slice(id.length + 3)}`;
    if (this.live) {
      this.timer = setInterval(() => this.spin(), 120);
    }
  }

  private spin(): void {
    const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
    const width = process.stdout.columns ?? 100;
    const text = `  ${frames[this.frame++ % frames.length]} ${this.running}`.slice(0, width - 1);
    process.stdout.write(`\r\u001b[2K\u001b[2m${text}\u001b[0m`);
  }

  private clear(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.live) {
      process.stdout.write('\r\u001b[2K');
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.clear();
    const row = rowOf(test, result);
    this.rows.push(row);
    if (row.kind !== 'skip') {
      process.stdout.write(rowLines(row, this.style, process.stdout.columns ?? 100).join('\n') + '\n');
    }
  }

  onEnd(_result: FullResult): void {
    this.clear();
    process.stdout.write(summaryLines(this.rows, Date.now() - this.started, this.style).join('\n') + '\n');
  }
}

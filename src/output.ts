import chalk from "chalk";

/** Disable ANSI color when --no-color is passed or NO_COLOR is set. */
export function configureColor(disable: boolean): void {
  if (disable || process.env.NO_COLOR) {
    chalk.level = 0;
  }
}

export interface Logger {
  /** Progress/detail — only shown with --verbose. Goes to stderr. */
  info(message: string): void;
  /** Always shown. Goes to stderr so stdout stays clean for the report. */
  warn(message: string): void;
  error(message: string): void;
}

export function makeLogger(verbose: boolean): Logger {
  return {
    info(message: string) {
      if (verbose) process.stderr.write(`${chalk.dim(message)}\n`);
    },
    warn(message: string) {
      process.stderr.write(`${chalk.yellow(message)}\n`);
    },
    error(message: string) {
      process.stderr.write(`${chalk.red(message)}\n`);
    },
  };
}

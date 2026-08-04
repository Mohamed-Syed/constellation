#!/usr/bin/env node
import { Command } from "commander";
import { generatePlugin } from "./generate-plugin.js";
import { registerOps } from "./ops.js";

const program = new Command();

program
  .name("constellation")
  .description("Constellation platform CLI — scaffold plugins and inspect the live platform.")
  .version("0.2.0");

program
  .command("generate-plugin")
  .alias("gen")
  .description("Scaffold a new Constellation plugin under plugins/<kebab-name>")
  .argument("<Name>", 'Plugin name, e.g. "My Cool Plugin" or "MyCoolPlugin"')
  .option("-f, --force", "overwrite an existing plugin directory", false)
  .action((name: string, opts: { force: boolean }) => {
    try {
      const result = generatePlugin(name, { force: opts.force });
      console.log(`Created plugin "${result.id}" at ${result.dir}`);
    } catch (err) {
      console.error(`generate-plugin failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

// Ops subcommands (health, engine status, tasks, schedules, deadletters, plugins).
registerOps(program);

// Show help by default (no args).
if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

await program.parseAsync(process.argv);

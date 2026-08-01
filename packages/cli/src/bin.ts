#!/usr/bin/env node
import { Command } from "commander";
import { generatePlugin } from "./generate-plugin.js";

const program = new Command();

program
  .name("generate-plugin")
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

await program.parseAsync(process.argv);

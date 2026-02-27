#!/usr/bin/env node
import { buildCli } from "../src/cli/commands.js";

const program = buildCli();
program.parse();

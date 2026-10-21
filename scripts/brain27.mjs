import { main } from "../lib/local-apply/cli.ts";

process.exitCode = await main(process.argv.slice(2));

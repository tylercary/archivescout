/** Registers the TS resolver hook. Use: node --import ./scripts/ts-register.mjs … */
import { register } from "node:module";
register(new URL("./ts-resolve.mjs", import.meta.url));

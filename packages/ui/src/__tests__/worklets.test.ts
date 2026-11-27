// Guard on the BUILT package (`npm run build` first, as CI does): every lib module with
// worklets, run through the host's worklets Babel plugin, must load and export what tsc
// says it exports. tsc's CommonJS assigns a function's export at the top of the file,
// relying on hoisting, and the plugin turns a worklet function declaration into an
// unhoisted `var`: `export function f() { "worklet" }` shipped `f` as undefined (every
// gesture threw "undefined is not a function", web crashed at load).
import { transformSync } from "@babel/core";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lib = join(__dirname, "../../lib");
const worklets = require.resolve("react-native-worklets/plugin");

const files = existsSync(lib)
  ? (readdirSync(lib, { recursive: true }) as string[])
      .filter((f) => f.endsWith(".js"))
      .filter((f) => readFileSync(join(lib, f), "utf8").includes('"worklet"'))
  : [];

// Any import (react-native, reanimated, siblings…): an object whose every property is
// another such stub, callable, so a module's top level runs without its dependencies.
const stub = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => "" : stub()),
    apply: () => stub(),
    construct: () => stub() as object,
  });

/** Loads a built module as a host would after the worklets plugin. */
function load(file: string): Record<string, unknown> {
  const src = readFileSync(join(lib, file), "utf8");
  const code = transformSync(src, {
    filename: join(lib, file),
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["jsx"] },
    plugins: [worklets, "@babel/plugin-transform-react-jsx"],
  })!.code!;
  const module = { exports: {} as Record<string, unknown> };
  new Function("exports", "module", "require", code)(module.exports, module, stub);
  return module.exports;
}

describe("worklets in the built package", () => {
  it("finds the built modules with worklets", () => {
    expect(existsSync(lib), "run `npm run build` before the tests").toBe(true);
    expect(files).toContain(join("utils", "chatGestures.js"));
  });

  it.each(files)("%s loads after the worklets plugin, every export defined", (file) => {
    const exported = load(file);
    // What tsc exports: `exports.x = …` and `exports.x = exports.y = void 0` lines.
    const src = readFileSync(join(lib, file), "utf8");
    const names = [...src.matchAll(/(?:^|= )exports\.(\w+) =/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of new Set(names)) expect(exported[name], name).toBeDefined();
  });

  it("the gesture helpers work as worklets", () => {
    const g = load(join("utils", "chatGestures.js")) as Record<string, (...a: never[]) => unknown>;
    for (const f of ["swipeOffset", "swipeTriggered", "startsAtEdge", "hitsControl"])
      expect(typeof g[f], f).toBe("function");
    expect(g.swipeOffset!(20 as never)).toBe(10);
    expect(g.SWIPE_ARMED_OFFSET).toBe(32);
    expect(g.startsAtEdge!(0 as never)).toBe(true);
  });
});

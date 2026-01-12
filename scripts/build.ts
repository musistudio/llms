import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const baseConfig: esbuild.BuildOptions = {
  entryPoints: ["src/server.ts", "src/index.ts"],
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: "node",
  target: "node18",
  plugins: [],
  external: ["fastify", "dotenv", "@fastify/cors", "undici"],
};

const cjsConfig: esbuild.BuildOptions = {
  ...baseConfig,
  outdir: "dist/cjs",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
};

const esmConfig: esbuild.BuildOptions = {
  ...baseConfig,
  outdir: "dist/esm",
  format: "esm",
  outExtension: { ".js": ".mjs" },
};

async function build() {
  console.log("Building CJS and ESM versions...");
  
  const cjsCtx = await esbuild.context(cjsConfig);
  const esmCtx = await esbuild.context(esmConfig);

  if (watch) {
    console.log("Watching for changes...");
    await Promise.all([
      cjsCtx.watch(),
      esmCtx.watch(),
    ]);
  } else {
    await Promise.all([
      cjsCtx.rebuild(),
      esmCtx.rebuild(),
    ]);
    
    await Promise.all([
      cjsCtx.dispose(),
      esmCtx.dispose(),
    ]);
    
    console.log("✅ Build completed successfully!");
    console.log("  - CJS: dist/cjs/server.cjs");
    console.log("  - ESM: dist/esm/server.mjs");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

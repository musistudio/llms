import * as esbuild from "esbuild";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

const watch = process.argv.includes("--watch");

const baseConfig: esbuild.BuildOptions = {
  entryPoints: ["src/server.ts"],
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

async function generateDeclarationFiles() {
  console.log("Generating declaration files...");

  // 读取 tsconfig.json
  const tsConfigPath = path.resolve(process.cwd(), "tsconfig.json");
  const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);

  if (configFile.error) {
    console.error("Error reading tsconfig.json:", configFile.error);
    return;
  }

  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsConfigPath)
  );

  if (config.errors.length > 0) {
    console.error("Errors in tsconfig.json:", config.errors);
    return;
  }

  // 修改配置以生成声明文件到正确的目录
  config.options.declaration = true;
  config.options.declarationMap = true;
  config.options.emitDeclarationOnly = true;

  // 创建两个编译器实例，分别用于 CJS 和 ESM
  const createProgramAndEmit = (outDir: string) => {
    const compilerOptions = {
      ...config.options,
      outDir,
    };

    const host = ts.createCompilerHost(compilerOptions);
    const program = ts.createProgram(config.fileNames, compilerOptions, host);

    const emitResult = program.emit();

    if (emitResult.diagnostics.length > 0) {
      console.error("TypeScript declaration generation errors:");
      emitResult.diagnostics.forEach(diagnostic => {
        if (diagnostic.file) {
          const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start!);
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
          console.error(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
        } else {
          console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        }
      });
    }

    return emitResult;
  };

  // 生成 CJS 声明文件
  createProgramAndEmit("dist/cjs");

  // 生成 ESM 声明文件
  createProgramAndEmit("dist/esm");

  console.log("✅ Declaration files generated successfully!");
}

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

    // 生成类型声明文件
    await generateDeclarationFiles();

    console.log("✅ Build completed successfully!");
    console.log("  - CJS: dist/cjs/server.cjs");
    console.log("  - ESM: dist/esm/server.mjs");
    console.log("  - Types: dist/cjs/server.d.ts, dist/esm/server.d.ts");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

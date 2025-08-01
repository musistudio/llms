import { Transformer, TransformerConstructor } from "@/types/transformer";
import { log } from "@/utils/log";
import { ConfigService } from "./config";
import Transformers from "@/transformer";
import Module from "node:module";

interface TransformerConfig {
  transformers: Array<{
    name: string;
    type: "class" | "module";
    path?: string;
    options?: any;
  }>;
}

export class TransformerService {
  private transformers: Map<string, Transformer | TransformerConstructor> = new Map();

  constructor(private readonly configService: ConfigService) {
  }

  registerTransformer(name: string, transformer: Transformer): void {
    this.transformers.set(name, transformer);
    log(
      `register transformer: ${name}${transformer.endPoint
        ? ` (endpoint: ${transformer.endPoint})`
        : " (no endpoint)"
      }`
    );
  }

  getTransformer(name: string): Transformer | TransformerConstructor | undefined {
    return this.transformers.get(name);
  }

  getAllTransformers(): Map<string, Transformer | TransformerConstructor> {
    return new Map(this.transformers);
  }

  getTransformersWithEndpoint(): { name: string; transformer: Transformer }[] {
    const result: { name: string; transformer: Transformer }[] = [];

    this.transformers.forEach((transformerOrConstructor, name) => {
      let transformer: Transformer;
      if (typeof transformerOrConstructor === 'function') {
        transformer = new (transformerOrConstructor as TransformerConstructor)();
      } else {
        transformer = transformerOrConstructor;
      }
      
      if (transformer.endPoint) {
        result.push({ name, transformer });
      }
    });

    return result;
  }

  getTransformersWithoutEndpoint(): {
    name: string;
    transformer: Transformer;
  }[] {
    const result: { name: string; transformer: Transformer }[] = [];

    this.transformers.forEach((transformerOrConstructor, name) => {
      let transformer: Transformer;
      if (typeof transformerOrConstructor === 'function') {
        transformer = new (transformerOrConstructor as TransformerConstructor)();
      } else {
        transformer = transformerOrConstructor;
      }
      
      if (!transformer.endPoint) {
        result.push({ name, transformer });
      }
    });

    return result;
  }

  removeTransformer(name: string): boolean {
    return this.transformers.delete(name);
  }

  hasTransformer(name: string): boolean {
    return this.transformers.has(name);
  }

  async registerTransformerFromConfig(config: {
    path?: string;
    options?: any;
  }): Promise<boolean> {
    try {
      // @ts-ignore
      const originalLoad = Module._load;
      // @ts-ignore
      Module._load = function (request, parent, isMain) {
        if (request === "claude-code-router") {
          return {
            log,
          };
        }
        return originalLoad.apply(Module, arguments);
      };
      if (config.path) {
        const module = require(require.resolve(config.path));
        if (module) {
          const instance = new module(config.options);
          if (!instance.name) {
            throw new Error(
              `Transformer instance from ${config.path} does not have a name property.`
            );
          }
          this.registerTransformer(instance.name, instance);
          return true;
        }
      }
      return false;
    } catch (error: any) {
      log(`load transformer (${config.path}) error:`, error.message, error.stack);
      return false;
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.registerDefaultTransformersInternal();
      await this.loadFromConfig();
    } catch (error) {
      log("TransformerService init error:", error);
    }
  }

  private async registerDefaultTransformersInternal(): Promise<void> {
    try {
      Object.values(Transformers)
        .forEach((TransformerStatic: any) => {
          if ('TransformerName' in TransformerStatic && typeof TransformerStatic.TransformerName === 'string') {
            this.registerTransformer(TransformerStatic.TransformerName, TransformerStatic);
          } else {
            // Create a temporary instance to get the name
            const tempInstance = new TransformerStatic();
            this.registerTransformer(tempInstance.name!, TransformerStatic);
          }
        })
    } catch (error) {
      log("transformer regist error:", error);
    }
  }

  private async loadFromConfig(): Promise<void> {
    const transformers = this.configService.get<
      TransformerConfig["transformers"]
    >("transformers", []);
    for (const transformer of transformers) {
      await this.registerTransformerFromConfig(transformer);
    }
  }
}

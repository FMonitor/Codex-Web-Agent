import type { RuntimeName } from "@codex-web-agent/shared";
import type { RuntimeAdapter, RuntimeInfo } from "./runtime-adapter.js";

export class RuntimeRegistry {
  constructor(
    private readonly adapters: RuntimeAdapter[],
    private readonly preferredDefault?: RuntimeName,
  ) {}

  getDefaultRuntime(preferred?: RuntimeName): RuntimeName {
    if (preferred && this.hasRuntime(preferred)) {
      return preferred;
    }
    if (this.preferredDefault && this.hasRuntime(this.preferredDefault)) {
      return this.preferredDefault;
    }
    const available = this.adapters.find((adapter) => adapter.getRuntimeInfo().available);
    return available?.runtimeName || this.adapters[0]!.runtimeName;
  }

  getAdapter(runtime?: RuntimeName): RuntimeAdapter {
    const resolved = this.getDefaultRuntime(runtime);
    const adapter = this.adapters.find((item) => item.runtimeName === resolved);
    if (!adapter) {
      throw new Error(`Unsupported runtime: ${resolved}`);
    }
    return adapter;
  }

  listRuntimeInfo(): RuntimeInfo[] {
    return this.adapters.map((adapter) => adapter.getRuntimeInfo());
  }

  private hasRuntime(runtime: RuntimeName): boolean {
    return this.adapters.some((adapter) => adapter.runtimeName === runtime);
  }
}

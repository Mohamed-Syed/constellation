import { AsyncLocalStorage } from "node:async_hooks";
import { ROOT_CONTEXT, type Context, type ContextManager } from "@opentelemetry/api";

/**
 * Minimal AsyncLocalStorage-based ContextManager (OTel JS 2.x no longer ships
 * one in the packages we use — the official one lives in @opentelemetry/sdk-node,
 * which is too heavy a dependency for one class). Implements the small
 * `ContextManager` interface from @opentelemetry/api using node:async_hooks.
 *
 * `with()` runs `fn` with `ctx` active for the whole async tree (await
 * boundaries included), which is what makes parent-child spans work:
 * engine.task.run -> engine.task.step -> model.call / plugin.tool.invoke.
 *
 * Registered by TracingService ONLY when tracing is enabled — the additive
 * invariant holds (unset endpoint = nothing is registered, zero side effects).
 */
export class AlsContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const bound = thisArg === undefined ? fn : fn.bind(thisArg);
    return this.storage.run(context, bound as (...args: A) => ReturnType<F>, ...args);
  }

  bind<T>(context: Context, target: T): T {
    if (typeof target === "function") {
      const bound = (...args: unknown[]) =>
        this.storage.run(context, target as (...a: unknown[]) => unknown, undefined, ...args);
      Object.assign(bound, target);
      return bound as T;
    }
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    return this;
  }
}

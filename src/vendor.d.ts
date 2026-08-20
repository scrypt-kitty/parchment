// markdown-it-task-lists ships no types.
declare module "markdown-it-task-lists" {
  import type { PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default plugin;
}

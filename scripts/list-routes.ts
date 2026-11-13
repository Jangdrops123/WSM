import { routerPos } from '../server/routes/pos.ts';

const r = routerPos() as unknown as { stack?: { route?: { path: string; methods: Record<string, boolean> } }[] };
const stack = r.stack ?? [];
for (const layer of stack) {
  const methods = Object.keys(layer.route?.methods ?? {}).join(',').toUpperCase();
  console.log(methods, layer.route?.path);
}
console.log('total', stack.length);
process.exit(0);
